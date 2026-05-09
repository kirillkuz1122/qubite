package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"qubite-vpn/internal/api"
	"qubite-vpn/internal/core"
	"qubite-vpn/internal/server"
)

//go:embed all:web
var webFS embed.FS

const (
	defaultBaseURL = "https://qubiteapp.ru"
	windowWidth    = 420
	windowHeight   = 720
)

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Println("[qubite-vpn] starting...")

	// Data directory
	dataDir := appDataDir()
	os.MkdirAll(dataDir, 0700)

	// Determine API base URL
	baseURL := os.Getenv("QUBITE_API_URL")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	// Init API client
	apiClient := api.NewClient(baseURL)
	apiClient.SetDataDir(dataDir)

	// Load persisted device ID
	deviceID := loadOrCreateDeviceID(dataDir)
	apiClient.SetDeviceID(deviceID)

	// Load persisted session (auto-login if cookie still valid)
	if apiClient.LoadSession() {
		log.Println("[auth] session loaded from disk")
	}

	// Init sing-box manager
	singbox := core.NewSingboxManager()
	if !singbox.BinaryExists() {
		log.Printf("[warn] sing-box not found at: %s", singbox.BinaryPath())
	} else {
		log.Printf("[ok] sing-box found: %s", singbox.BinaryPath())
	}

	// Start HTTP server for web UI
	srv := server.New(apiClient, singbox, webFS)
	port, err := srv.Start()
	if err != nil {
		log.Fatalf("server start: %s", err)
	}
	appURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	log.Printf("[ok] UI server: %s", appURL)

	// Open app window
	appProc := openAppWindow(appURL)

	// Graceful shutdown on signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	if appProc != nil {
		done := make(chan struct{})
		go func() {
			appProc.Wait()
			close(done)
		}()
		select {
		case <-done:
			log.Println("[shutdown] app window closed")
		case <-sigCh:
			log.Println("[shutdown] signal received")
			appProc.Process.Kill()
		}
	} else {
		log.Println("[info] running headless, Ctrl+C to stop")
		<-sigCh
		log.Println("[shutdown] signal received")
	}

	srv.Shutdown()
	log.Println("[shutdown] done")
}

func appDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".qubite-vpn")
}

func loadOrCreateDeviceID(dataDir string) string {
	idFile := filepath.Join(dataDir, "device-id")

	data, err := os.ReadFile(idFile)
	if err == nil && len(data) > 0 {
		return string(data)
	}

	id := fmt.Sprintf("PD-%d-%d", time.Now().Unix(), os.Getpid())
	os.WriteFile(idFile, []byte(id), 0600)
	return id
}

func openAppWindow(url string) *exec.Cmd {
	tmpDir := filepath.Join(os.TempDir(), "qubite-vpn-browser")
	os.MkdirAll(tmpDir, 0700)

	args := []string{
		fmt.Sprintf("--app=%s", url),
		fmt.Sprintf("--window-size=%d,%d", windowWidth, windowHeight),
		"--disable-extensions",
		"--disable-plugins",
		"--no-first-run",
		"--no-default-browser-check",
		fmt.Sprintf("--user-data-dir=%s", tmpDir),
	}

	browsers := findBrowserPaths()

	for _, browser := range browsers {
		cmd := exec.Command(browser, args...)
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Start(); err == nil {
			log.Printf("[ok] opened app window: %s", filepath.Base(browser))
			return cmd
		}
	}

	log.Println("[warn] no browser found for app mode, opening default")
	openDefault(url)
	return nil
}

func findBrowserPaths() []string {
	var paths []string

	if runtime.GOOS == "windows" {
		pf := os.Getenv("ProgramFiles")
		pfx86 := os.Getenv("ProgramFiles(x86)")
		localApp := os.Getenv("LOCALAPPDATA")

		candidates := []string{
			filepath.Join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(pf, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				paths = append(paths, p)
			}
		}
	}

	return paths
}

func openDefault(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
