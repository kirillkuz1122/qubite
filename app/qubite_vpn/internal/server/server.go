package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sort"
	"sync"
	"time"

	"qubite-vpn/internal/api"
	"qubite-vpn/internal/core"
)

type Server struct {
	api     *api.Client
	singbox *core.SingboxManager
	port    int
	mux     *http.ServeMux

	mu             sync.RWMutex
	sessionID      string
	servers        []api.Server
	routing        *api.RoutingProfile
	selectedServer *api.Server
	connectedAt    time.Time

	heartbeatStop chan struct{}
}

func New(apiClient *api.Client, singbox *core.SingboxManager, webFS embed.FS) *Server {
	s := &Server{
		api:     apiClient,
		singbox: singbox,
		mux:     http.NewServeMux(),
	}

	// Serve embedded web UI
	webSub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed web: %s", err)
	}
	fileServer := http.FileServer(http.FS(webSub))
	s.mux.Handle("/", fileServer)

	// Auth routes
	s.mux.HandleFunc("/api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("/api/auth/login", s.handleLogin)
	s.mux.HandleFunc("/api/auth/register", s.handleRegister)
	s.mux.HandleFunc("/api/auth/email/verify", s.handleVerifyEmail)
	s.mux.HandleFunc("/api/auth/challenges/resend", s.handleResendChallenge)
	s.mux.HandleFunc("/api/auth/logout", s.handleLogout)

	// VPN routes
	s.mux.HandleFunc("/api/status", s.handleStatus)
	s.mux.HandleFunc("/api/servers", s.handleServers)
	s.mux.HandleFunc("/api/connect", s.handleConnect)
	s.mux.HandleFunc("/api/disconnect", s.handleDisconnect)

	return s
}

func (s *Server) Start() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("listen: %w", err)
	}
	s.port = listener.Addr().(*net.TCPAddr).Port

	go func() {
		srv := &http.Server{Handler: s.mux}
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %s", err)
		}
	}()

	return s.port, nil
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// --- Auth handlers ---

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if !s.api.IsLoggedIn() {
		writeJSON(w, map[string]interface{}{
			"authenticated": false,
		})
		return
	}

	user, err := s.api.CheckAuth()
	if err != nil || user == nil {
		writeJSON(w, map[string]interface{}{
			"authenticated": false,
		})
		return
	}

	writeJSON(w, map[string]interface{}{
		"authenticated": true,
		"user": map[string]string{
			"id":    user.ID,
			"login": user.Login,
		},
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	var req struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad request")
		return
	}

	if req.Login == "" || req.Password == "" {
		writeError(w, 400, "Заполни логин и пароль")
		return
	}

	user, err := s.api.Login(req.Login, req.Password)
	if err != nil {
		// Check if it's a 2FA requirement
		errStr := err.Error()
		if len(errStr) > 14 && errStr[:14] == "2FA_REQUIRED:" {
			writeJSON(w, map[string]interface{}{
				"requiresTwoFactor": true,
				"flowToken":         errStr[14:],
			})
			return
		}
		writeError(w, 401, errStr)
		return
	}

	writeJSON(w, map[string]interface{}{
		"authenticated": true,
		"user": map[string]string{
			"id":    user.ID,
			"login": user.Login,
		},
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	var req struct {
		Login    string `json:"login"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad request")
		return
	}

	if req.Login == "" || req.Email == "" || req.Password == "" {
		writeError(w, 400, "Заполни все поля")
		return
	}

	result, err := s.api.Register(req.Login, req.Email, req.Password)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}

	resp := map[string]interface{}{
		"authenticated":             true,
		"emailVerificationRequired": result.EmailVerificationRequired,
	}
	if result.User != nil {
		resp["user"] = map[string]string{
			"id":    result.User.ID,
			"login": result.User.Login,
		}
	}
	if result.Challenge != nil {
		resp["challenge"] = map[string]string{
			"flowToken": result.Challenge.FlowToken,
			"delivery":  result.Challenge.Delivery,
			"expiresAt": result.Challenge.ExpiresAt,
		}
	}
	writeJSON(w, resp)
}

func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	var req struct {
		FlowToken string `json:"flowToken"`
		Code      string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad request")
		return
	}

	if req.FlowToken == "" || req.Code == "" {
		writeError(w, 400, "Введите код подтверждения")
		return
	}

	user, err := s.api.VerifyEmail(req.FlowToken, req.Code)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}

	resp := map[string]interface{}{"success": true}
	if user != nil {
		resp["user"] = map[string]string{
			"id":    user.ID,
			"login": user.Login,
		}
	}
	writeJSON(w, resp)
}

func (s *Server) handleResendChallenge(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	var req struct {
		FlowToken string `json:"flowToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad request")
		return
	}

	if err := s.api.ResendChallenge(req.FlowToken); err != nil {
		writeError(w, 400, err.Error())
		return
	}

	writeJSON(w, map[string]string{"status": "resent"})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	// Disconnect VPN first if connected
	if s.singbox.State() == core.StateRunning {
		s.stopHeartbeat()
		s.singbox.Stop()
		s.mu.RLock()
		sid := s.sessionID
		s.mu.RUnlock()
		if sid != "" {
			s.api.StopSession(sid)
		}
		s.mu.Lock()
		s.sessionID = ""
		s.selectedServer = nil
		s.mu.Unlock()
	}

	_ = s.api.Logout()

	writeJSON(w, map[string]string{"status": "logged_out"})
}

// --- VPN handlers ---

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	state := s.singbox.State()
	status := map[string]interface{}{
		"state":         state.String(),
		"sessionId":     s.sessionID,
		"singboxPath":   s.singbox.BinaryPath(),
		"singboxOk":     s.singbox.BinaryExists(),
		"authenticated": s.api.IsLoggedIn(),
	}

	if state == core.StateRunning {
		status["uptime"] = int(s.singbox.Uptime().Seconds())
		if s.selectedServer != nil {
			status["server"] = map[string]string{
				"name":   s.selectedServer.Name,
				"region": s.selectedServer.Region,
				"domain": s.selectedServer.Domain,
			}
		}
	}

	if state == core.StateError {
		status["error"] = s.singbox.LastError()
	}

	writeJSON(w, status)
}

func (s *Server) handleServers(w http.ResponseWriter, r *http.Request) {
	if !s.api.IsLoggedIn() {
		writeError(w, 401, "not authenticated")
		return
	}

	servers, err := s.api.ListServers()
	if err != nil {
		writeError(w, 502, fmt.Sprintf("fetch servers: %s", err))
		return
	}

	s.mu.Lock()
	s.servers = servers
	s.mu.Unlock()

	sort.Slice(servers, func(i, j int) bool {
		if servers[i].Priority != servers[j].Priority {
			return servers[i].Priority < servers[j].Priority
		}
		return servers[i].Weight > servers[j].Weight
	})

	writeJSON(w, map[string]interface{}{"servers": servers})
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	if !s.api.IsLoggedIn() {
		writeError(w, 401, "not authenticated")
		return
	}

	if !s.singbox.BinaryExists() {
		writeError(w, 500, fmt.Sprintf("sing-box not found at: %s", s.singbox.BinaryPath()))
		return
	}

	if s.singbox.State() == core.StateRunning {
		writeError(w, 409, "already connected")
		return
	}

	var req struct {
		ServerID string `json:"serverId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad request")
		return
	}

	// Register device first (idempotent)
	hostname := "QubiteVPN Desktop"
	if _, err := s.api.RegisterDevice(hostname); err != nil {
		log.Printf("[connect] register device: %s", err)
	}

	// If no server specified, pick best one
	if req.ServerID == "" {
		s.mu.RLock()
		servers := s.servers
		s.mu.RUnlock()

		if len(servers) == 0 {
			var err error
			servers, err = s.api.ListServers()
			if err != nil {
				writeError(w, 502, fmt.Sprintf("fetch servers: %s", err))
				return
			}
			s.mu.Lock()
			s.servers = servers
			s.mu.Unlock()
		}

		if len(servers) == 0 {
			writeError(w, 404, "no servers available")
			return
		}

		sort.Slice(servers, func(i, j int) bool {
			if servers[i].Priority != servers[j].Priority {
				return servers[i].Priority < servers[j].Priority
			}
			return servers[i].Weight > servers[j].Weight
		})
		req.ServerID = servers[0].ID

		s.mu.Lock()
		s.selectedServer = &servers[0]
		s.mu.Unlock()
	} else {
		// Find the selected server in the list
		s.mu.RLock()
		servers := s.servers
		s.mu.RUnlock()
		for i := range servers {
			if servers[i].ID == req.ServerID {
				s.mu.Lock()
				s.selectedServer = &servers[i]
				s.mu.Unlock()
				break
			}
		}
	}

	// Start proxy session
	session, routing, err := s.api.StartSession(req.ServerID)
	if err != nil {
		writeError(w, 502, fmt.Sprintf("start session: %s", err))
		return
	}

	s.mu.Lock()
	s.sessionID = session.ID
	s.routing = routing
	s.connectedAt = time.Now()
	s.mu.Unlock()

	// Generate sing-box config
	configJSON, err := core.BuildSingboxConfig(session, routing)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("build config: %s", err))
		return
	}

	// Start sing-box
	if err := s.singbox.Start(configJSON); err != nil {
		writeError(w, 500, fmt.Sprintf("start singbox: %s", err))
		return
	}

	s.startHeartbeat()

	writeJSON(w, map[string]interface{}{
		"status": "connected",
		"server": session.Server,
	})
}

func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "POST only")
		return
	}

	s.stopHeartbeat()

	if err := s.singbox.Stop(); err != nil {
		log.Printf("[disconnect] singbox stop: %s", err)
	}

	s.mu.RLock()
	sid := s.sessionID
	s.mu.RUnlock()

	if sid != "" {
		if err := s.api.StopSession(sid); err != nil {
			log.Printf("[disconnect] stop session: %s", err)
		}
	}

	s.mu.Lock()
	s.sessionID = ""
	s.selectedServer = nil
	s.mu.Unlock()

	writeJSON(w, map[string]string{"status": "disconnected"})
}

func (s *Server) startHeartbeat() {
	s.stopHeartbeat()
	s.heartbeatStop = make(chan struct{})
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := s.api.Heartbeat(); err != nil {
					log.Printf("[heartbeat] error: %s", err)
				}
			case <-s.heartbeatStop:
				return
			}
		}
	}()
}

func (s *Server) stopHeartbeat() {
	if s.heartbeatStop != nil {
		close(s.heartbeatStop)
		s.heartbeatStop = nil
	}
}

func (s *Server) Shutdown() {
	s.stopHeartbeat()
	if s.singbox.State() == core.StateRunning {
		s.singbox.Stop()
	}
	s.mu.RLock()
	sid := s.sessionID
	s.mu.RUnlock()
	if sid != "" {
		s.api.StopSession(sid)
	}
}
