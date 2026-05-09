package core

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

type State int

const (
	StateStopped State = iota
	StateStarting
	StateRunning
	StateStopping
	StateError
)

func (s State) String() string {
	switch s {
	case StateStopped:
		return "stopped"
	case StateStarting:
		return "starting"
	case StateRunning:
		return "running"
	case StateStopping:
		return "stopping"
	case StateError:
		return "error"
	}
	return "unknown"
}

type SingboxManager struct {
	mu         sync.RWMutex
	cmd        *exec.Cmd
	state      State
	lastError  string
	configPath string
	binaryPath string
	startedAt  time.Time
}

func NewSingboxManager() *SingboxManager {
	return &SingboxManager{
		state:      StateStopped,
		binaryPath: findSingboxBinary(),
	}
}

func findSingboxBinary() string {
	// Look near executable first
	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)

	candidates := []string{
		filepath.Join(exeDir, "sing-box.exe"),
		filepath.Join(exeDir, "sing-box"),
		filepath.Join(exeDir, "core_build", runtime.GOOS, "sing-box.exe"),
		filepath.Join(exeDir, "core_build", runtime.GOOS, "sing-box"),
	}

	// Also check relative to working directory
	cwd, _ := os.Getwd()
	candidates = append(candidates,
		filepath.Join(cwd, "core_build", runtime.GOOS, "sing-box.exe"),
		filepath.Join(cwd, "core_build", runtime.GOOS, "sing-box"),
		filepath.Join(cwd, "sing-box.exe"),
		filepath.Join(cwd, "sing-box"),
	)

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Fallback: hope it's in PATH
	if p, err := exec.LookPath("sing-box"); err == nil {
		return p
	}
	return "sing-box"
}

func (m *SingboxManager) State() State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

func (m *SingboxManager) LastError() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.lastError
}

func (m *SingboxManager) Uptime() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.state == StateRunning {
		return time.Since(m.startedAt)
	}
	return 0
}

func (m *SingboxManager) Start(configJSON []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state == StateRunning || m.state == StateStarting {
		return fmt.Errorf("already running")
	}

	// Check binary exists
	if _, err := os.Stat(m.binaryPath); os.IsNotExist(err) {
		m.state = StateError
		m.lastError = fmt.Sprintf("sing-box not found: %s", m.binaryPath)
		return fmt.Errorf("%s", m.lastError)
	}

	m.state = StateStarting
	m.lastError = ""

	// Write config to temp file
	tmpDir := os.TempDir()
	m.configPath = filepath.Join(tmpDir, "qubite-singbox-config.json")
	if err := os.WriteFile(m.configPath, configJSON, 0600); err != nil {
		m.state = StateError
		m.lastError = fmt.Sprintf("write config: %s", err)
		return fmt.Errorf("%s", m.lastError)
	}

	// Start sing-box process
	m.cmd = exec.Command(m.binaryPath, "run", "-c", m.configPath)
	m.cmd.Stdout = os.Stdout
	m.cmd.Stderr = os.Stderr

	// Isolate environment: remove proxy env vars
	env := os.Environ()
	filtered := make([]string, 0, len(env))
	for _, e := range env {
		skip := false
		for _, prefix := range []string{"HTTP_PROXY=", "HTTPS_PROXY=", "ALL_PROXY=", "http_proxy=", "https_proxy=", "all_proxy="} {
			if len(e) >= len(prefix) && e[:len(prefix)] == prefix {
				skip = true
				break
			}
		}
		if !skip {
			filtered = append(filtered, e)
		}
	}
	m.cmd.Env = filtered

	if err := m.cmd.Start(); err != nil {
		m.state = StateError
		m.lastError = fmt.Sprintf("start: %s", err)
		return fmt.Errorf("%s", m.lastError)
	}

	m.state = StateRunning
	m.startedAt = time.Now()

	// Watch process in background
	go func() {
		err := m.cmd.Wait()
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.state == StateStopping {
			m.state = StateStopped
		} else {
			m.state = StateError
			if err != nil {
				m.lastError = fmt.Sprintf("process exited: %s", err)
			} else {
				m.lastError = "process exited unexpectedly"
			}
			log.Printf("[singbox] %s", m.lastError)
		}
		m.cleanup()
	}()

	log.Printf("[singbox] started (pid=%d)", m.cmd.Process.Pid)
	return nil
}

func (m *SingboxManager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state != StateRunning {
		return nil
	}

	m.state = StateStopping

	if m.cmd != nil && m.cmd.Process != nil {
		if err := m.cmd.Process.Kill(); err != nil {
			log.Printf("[singbox] kill error: %s", err)
		}
	}

	return nil
}

func (m *SingboxManager) cleanup() {
	if m.configPath != "" {
		os.Remove(m.configPath)
		m.configPath = ""
	}
}

func (m *SingboxManager) BinaryPath() string {
	return m.binaryPath
}

func (m *SingboxManager) BinaryExists() bool {
	_, err := os.Stat(m.binaryPath)
	return err == nil
}
