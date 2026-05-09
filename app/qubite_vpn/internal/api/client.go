package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const AppVersion = "0.1.0"

const sessionCookieName = "qb_session"

type Client struct {
	baseURL      string
	httpClient   *http.Client
	deviceID     string
	sessionToken string
	dataDir      string
	mu           sync.RWMutex
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SetDataDir(dir string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dataDir = dir
}

func (c *Client) SetDeviceID(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deviceID = id
}

func (c *Client) DeviceID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.deviceID
}

func (c *Client) IsLoggedIn() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.sessionToken != ""
}

// --- Auth models ---

type AuthUser struct {
	ID    string `json:"id"`
	Login string `json:"login"`
	Role  string `json:"role"`
}

// --- Proxy models ---

type Device struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Platform   string  `json:"platform"`
	AppVersion string  `json:"appVersion"`
	Status     string  `json:"status"`
	LastSeenAt string  `json:"lastSeenAt"`
	CreatedAt  string  `json:"createdAt"`
	RevokedAt  *string `json:"revokedAt"`
}

type ServerNetwork struct {
	IPv4       string `json:"ipv4"`
	IPv6       string `json:"ipv6"`
	IPv4Domain string `json:"ipv4Domain"`
	IPv6Domain string `json:"ipv6Domain"`
	SupportsV4 bool   `json:"supportsIpv4"`
	SupportsV6 bool   `json:"supportsIpv6"`
	Strategy   string `json:"strategy"`
}

type Server struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Domain   string        `json:"domain"`
	URL      string        `json:"url"`
	Network  ServerNetwork `json:"network"`
	Region   string        `json:"region"`
	Priority int           `json:"priority"`
	Weight   int           `json:"weight"`
	Health   string        `json:"health"`
}

type Credential struct {
	Type         string `json:"type"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	ExpiresAt    string `json:"expiresAt"`
	RefreshAfter string `json:"refreshAfter"`
}

type Transport struct {
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Host     string `json:"host"`
}

type SessionServer struct {
	Domain string `json:"domain"`
	URL    string `json:"url"`
	Region string `json:"region"`
}

type Session struct {
	ID         string        `json:"id"`
	Server     SessionServer `json:"server"`
	Credential Credential    `json:"credential"`
	Transport  Transport     `json:"transport"`
}

type RoutingRule struct {
	Action  string   `json:"action"`
	Domains []string `json:"domains,omitempty"`
	IPs     []string `json:"ips,omitempty"`
}

type RoutingProfile struct {
	Version       int           `json:"version"`
	DefaultAction string        `json:"defaultAction"`
	Rules         []RoutingRule `json:"rules"`
}

type CatalogEntry struct {
	ID          string `json:"id"`
	ServerID    string `json:"serverId"`
	Variant     string `json:"variant"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Domain      string `json:"domain"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"`
}

type Catalog struct {
	Version     int                       `json:"version"`
	GeneratedAt string                    `json:"generatedAt"`
	Normal      map[string][]CatalogEntry `json:"normal"`
	SNI         []json.RawMessage         `json:"sni"`
	Routing     *RoutingProfile           `json:"routingProfile"`
}

// --- Session persistence ---

func (c *Client) sessionFilePath() string {
	c.mu.RLock()
	dir := c.dataDir
	c.mu.RUnlock()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "session")
}

func (c *Client) LoadSession() bool {
	path := c.sessionFilePath()
	if path == "" {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	token := strings.TrimSpace(string(data))
	if token == "" {
		return false
	}
	c.mu.Lock()
	c.sessionToken = token
	c.mu.Unlock()
	return true
}

func (c *Client) saveSession() {
	path := c.sessionFilePath()
	if path == "" {
		return
	}
	c.mu.RLock()
	token := c.sessionToken
	c.mu.RUnlock()
	_ = os.MkdirAll(filepath.Dir(path), 0700)
	_ = os.WriteFile(path, []byte(token), 0600)
}

func (c *Client) clearSession() {
	c.mu.Lock()
	c.sessionToken = ""
	c.mu.Unlock()
	path := c.sessionFilePath()
	if path != "" {
		_ = os.Remove(path)
	}
}

// --- HTTP helpers ---

func (c *Client) doJSON(method, path string, body interface{}, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "QubiteVPN/"+AppVersion+" ("+runtime.GOOS+")")

	// Attach session cookie
	c.mu.RLock()
	token := c.sessionToken
	c.mu.RUnlock()
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	// Capture Set-Cookie for session updates
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookieName && cookie.Value != "" {
			c.mu.Lock()
			c.sessionToken = cookie.Value
			c.mu.Unlock()
			c.saveSession()
		}
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode >= 400 {
		// Try to extract error message from JSON response
		var errResp struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if json.Unmarshal(respBody, &errResp) == nil {
			msg := errResp.Error
			if msg == "" {
				msg = errResp.Message
			}
			if msg != "" {
				return fmt.Errorf("%s", msg)
			}
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	if result != nil {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("unmarshal: %w", err)
		}
	}
	return nil
}

// doRaw performs an HTTP request and returns raw response for cookie extraction.
func (c *Client) doRaw(method, path string, body interface{}) (*http.Response, []byte, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, nil, fmt.Errorf("marshal: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, nil, fmt.Errorf("request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "QubiteVPN/"+AppVersion+" ("+runtime.GOOS+")")

	c.mu.RLock()
	token := c.sessionToken
	c.mu.RUnlock()
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, nil, fmt.Errorf("read body: %w", err)
	}

	return resp, respBody, nil
}

// --- Auth API ---

// RegisterResult holds registration response including email challenge data.
type RegisterResult struct {
	User      *AuthUser        `json:"user"`
	Challenge *ChallengeInfo   `json:"authChallenge"`
	EmailVerificationRequired bool `json:"emailVerificationRequired"`
}

type ChallengeInfo struct {
	FlowToken string `json:"flowToken"`
	Delivery  string `json:"delivery"`
	ExpiresAt string `json:"expiresAt"`
}

func (c *Client) Register(login, email, password string) (*RegisterResult, error) {
	body := map[string]string{
		"login":    login,
		"email":    email,
		"password": password,
	}

	resp, respBody, err := c.doRaw("POST", "/api/auth/register", body)
	if err != nil {
		return nil, err
	}

	if resp != nil {
		for _, cookie := range resp.Cookies() {
			if cookie.Name == sessionCookieName && cookie.Value != "" {
				c.mu.Lock()
				c.sessionToken = cookie.Value
				c.mu.Unlock()
				c.saveSession()
			}
		}
	}

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error   string `json:"error"`
			Message string `json:"message"`
			Field   string `json:"field"`
		}
		if json.Unmarshal(respBody, &errResp) == nil {
			msg := errResp.Error
			if msg == "" {
				msg = errResp.Message
			}
			if msg != "" {
				return nil, fmt.Errorf("%s", msg)
			}
		}
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var result RegisterResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse register response: %w", err)
	}
	return &result, nil
}

func (c *Client) VerifyEmail(flowToken, code string) (*AuthUser, error) {
	body := map[string]string{
		"flowToken": flowToken,
		"code":      code,
	}
	var resp struct {
		Success bool      `json:"success"`
		User    *AuthUser `json:"user"`
	}
	if err := c.doJSON("POST", "/api/auth/email/verification/verify", body, &resp); err != nil {
		return nil, err
	}
	return resp.User, nil
}

func (c *Client) ResendChallenge(flowToken string) error {
	body := map[string]string{"flowToken": flowToken}
	return c.doJSON("POST", "/api/auth/challenges/resend", body, nil)
}

func (c *Client) Login(login, password string) (*AuthUser, error) {
	body := map[string]string{
		"login":    login,
		"password": password,
	}

	resp, respBody, err := c.doRaw("POST", "/api/auth/login", body)
	if err != nil {
		return nil, err
	}

	// Extract session cookie from Set-Cookie header
	if resp != nil {
		for _, cookie := range resp.Cookies() {
			if cookie.Name == sessionCookieName && cookie.Value != "" {
				c.mu.Lock()
				c.sessionToken = cookie.Value
				c.mu.Unlock()
				c.saveSession()
			}
		}
	}

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if json.Unmarshal(respBody, &errResp) == nil {
			msg := errResp.Error
			if msg == "" {
				msg = errResp.Message
			}
			if msg != "" {
				return nil, fmt.Errorf("%s", msg)
			}
		}
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	// Login may return 2FA challenge
	var loginResp struct {
		User              *AuthUser `json:"user"`
		RequiresTwoFactor bool      `json:"requiresTwoFactor"`
		FlowToken         string    `json:"flowToken"`
	}
	if err := json.Unmarshal(respBody, &loginResp); err != nil {
		return nil, fmt.Errorf("parse login response: %w", err)
	}

	if loginResp.RequiresTwoFactor {
		return nil, fmt.Errorf("2FA_REQUIRED:%s", loginResp.FlowToken)
	}

	return loginResp.User, nil
}

func (c *Client) CheckAuth() (*AuthUser, error) {
	var resp struct {
		Authenticated bool      `json:"authenticated"`
		User          *AuthUser `json:"user"`
	}
	if err := c.doJSON("GET", "/api/auth/me", nil, &resp); err != nil {
		return nil, err
	}
	if !resp.Authenticated || resp.User == nil {
		c.clearSession()
		return nil, nil
	}
	return resp.User, nil
}

func (c *Client) Logout() error {
	err := c.doJSON("POST", "/api/auth/logout", nil, nil)
	c.clearSession()
	return err
}

// --- Proxy API ---

func (c *Client) RegisterDevice(deviceName string) (*Device, error) {
	body := map[string]string{
		"deviceId":   c.DeviceID(),
		"deviceName": deviceName,
		"platform":   runtime.GOOS,
		"appVersion": AppVersion,
	}
	var resp struct {
		Device Device `json:"device"`
	}
	if err := c.doJSON("POST", "/api/proxy/devices/register", body, &resp); err != nil {
		return nil, err
	}
	c.SetDeviceID(resp.Device.ID)
	return &resp.Device, nil
}

func (c *Client) ListServers() ([]Server, error) {
	var resp struct {
		Servers []Server `json:"servers"`
	}
	if err := c.doJSON("GET", "/api/proxy/servers", nil, &resp); err != nil {
		return nil, err
	}
	return resp.Servers, nil
}

func (c *Client) GetCatalog() (*Catalog, error) {
	var resp Catalog
	if err := c.doJSON("GET", "/api/proxy/catalog", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) StartSession(serverID string) (*Session, *RoutingProfile, error) {
	body := map[string]string{
		"deviceId": c.DeviceID(),
		"serverId": serverID,
	}
	var resp struct {
		Session Session        `json:"session"`
		Routing RoutingProfile `json:"routingProfile"`
	}
	if err := c.doJSON("POST", "/api/proxy/session/start", body, &resp); err != nil {
		return nil, nil, err
	}
	return &resp.Session, &resp.Routing, nil
}

func (c *Client) RefreshSession(sessionID string) (*Session, error) {
	body := map[string]string{"sessionId": sessionID}
	var resp struct {
		Session Session `json:"session"`
	}
	if err := c.doJSON("POST", "/api/proxy/session/refresh", body, &resp); err != nil {
		return nil, err
	}
	return &resp.Session, nil
}

func (c *Client) StopSession(sessionID string) error {
	body := map[string]string{"sessionId": sessionID}
	return c.doJSON("POST", "/api/proxy/session/stop", body, nil)
}

func (c *Client) GetRoutingProfile() (*RoutingProfile, error) {
	var resp RoutingProfile
	if err := c.doJSON("GET", "/api/proxy/routing-profile", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) Heartbeat() error {
	body := map[string]interface{}{
		"deviceId":   c.DeviceID(),
		"active":     true,
		"appVersion": AppVersion,
	}
	return c.doJSON("POST", "/api/proxy/events/heartbeat", body, nil)
}

func (c *Client) SendTraffic(sessionID string, events []map[string]interface{}) error {
	body := map[string]interface{}{
		"deviceId":   c.DeviceID(),
		"sessionId":  sessionID,
		"appVersion": AppVersion,
		"events":     events,
	}
	return c.doJSON("POST", "/api/proxy/events/traffic", body, nil)
}


