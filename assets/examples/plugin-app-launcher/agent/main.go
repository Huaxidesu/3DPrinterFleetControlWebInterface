// HanyeLauncher — 本机隐藏助手：仅监听 127.0.0.1，按已绑定用户打开本地软件。
package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	version = "1.0.0"
	port    = "18791"
)

type config struct {
	UserID       string `json:"userId"`
	Username     string `json:"username"`
	PairToken    string `json:"pairToken"`
	ServerOrigin string `json:"serverOrigin"`
	MachineID    string `json:"machineId"`
}

type openReq struct {
	UserID    string `json:"userId"`
	PairToken string `json:"pairToken"`
	Path      string `json:"path"`
	OpenMode  string `json:"openMode"`
	Title     string `json:"title"`
}

type pairReq struct {
	UserID       string `json:"userId"`
	Username     string `json:"username"`
	PairToken    string `json:"pairToken"`
	ServerOrigin string `json:"serverOrigin"`
}

var (
	mu  sync.Mutex
	cfg config
)

func configPath() string {
	home, _ := os.UserHomeDir()
	var dir string
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = home
		}
		dir = filepath.Join(base, "HanyeLauncher")
	} else {
		dir = filepath.Join(home, "Library", "Application Support", "HanyeLauncher")
	}
	_ = os.MkdirAll(dir, 0o700)
	return filepath.Join(dir, "config.json")
}

func loadConfig() {
	b, err := os.ReadFile(configPath())
	if err != nil {
		if cfg.MachineID == "" {
			cfg.MachineID = newMachineID()
		}
		return
	}
	_ = json.Unmarshal(b, &cfg)
	if cfg.MachineID == "" {
		cfg.MachineID = newMachineID()
		saveConfig()
	}
}

func saveConfig() {
	b, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(configPath(), b, 0o600)
}

func newMachineID() string {
	host, _ := os.Hostname()
	return strings.TrimSpace(host) + "-" + runtime.GOOS
}

func cors(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Vary", "Origin")
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	c := cfg
	mu.Unlock()
	writeJSON(w, 200, map[string]interface{}{
		"ok":           true,
		"version":      version,
		"paired":       c.UserID != "" && c.PairToken != "",
		"userId":       c.UserID,
		"username":     c.Username,
		"machineId":    c.MachineID,
		"platform":     platformName(),
		"serverOrigin": c.ServerOrigin,
	})
}

func handlePair(w http.ResponseWriter, r *http.Request) {
	var req pairReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "message": "无效请求"})
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.PairToken = strings.TrimSpace(req.PairToken)
	if req.UserID == "" || req.PairToken == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "message": "缺少用户或配对令牌"})
		return
	}
	mu.Lock()
	cfg.UserID = req.UserID
	cfg.Username = strings.TrimSpace(req.Username)
	cfg.PairToken = req.PairToken
	cfg.ServerOrigin = strings.TrimRight(strings.TrimSpace(req.ServerOrigin), "/")
	if cfg.MachineID == "" {
		cfg.MachineID = newMachineID()
	}
	saveConfig()
	out := cfg
	mu.Unlock()
	writeJSON(w, 200, map[string]interface{}{
		"ok": true, "paired": true, "userId": out.UserID, "username": out.Username, "machineId": out.MachineID,
	})
}

func handleOpen(w http.ResponseWriter, r *http.Request) {
	var req openReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "message": "无效请求"})
		return
	}
	mu.Lock()
	c := cfg
	mu.Unlock()
	if c.UserID == "" || c.PairToken == "" {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "message": "本机助手尚未绑定账号，请到软件设置 → 快捷启动 点「绑定当前账号」"})
		return
	}
	if strings.TrimSpace(req.UserID) != c.UserID || strings.TrimSpace(req.PairToken) != c.PairToken {
		writeJSON(w, 403, map[string]interface{}{
			"ok": false,
			"message": "当前网页账号与本机助手绑定的「" + c.Username + "」不一致，请重新绑定",
		})
		return
	}
	target := strings.TrimSpace(req.Path)
	if target == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "message": "缺少路径"})
		return
	}
	if strings.ContainsAny(target, "\r\n\"") {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "message": "路径非法"})
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.OpenMode))
	if mode == "" {
		mode = "app"
	}
	if err := launch(target, mode); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "message": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true, "opened": true, "title": req.Title, "path": target})
}

func platformName() string {
	if runtime.GOOS == "windows" {
		return "win"
	}
	if runtime.GOOS == "darwin" {
		return "mac"
	}
	return runtime.GOOS
}

func launch(target, mode string) error {
	var cmd *exec.Cmd
	if mode == "url" || strings.Contains(target, "://") && !strings.HasPrefix(strings.ToLower(target), "file:") {
		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd.exe", "/c", "start", "", target)
		} else if runtime.GOOS == "darwin" {
			cmd = exec.Command("open", target)
		} else {
			cmd = exec.Command("xdg-open", target)
		}
	} else if runtime.GOOS == "windows" {
		cmd = exec.Command(target)
	} else if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", target)
	} else {
		cmd = exec.Command(target)
	}
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

func main() {
	loadConfig()
	mux := http.NewServeMux()
	wrap := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			cors(w, r)
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/status", wrap(handleStatus))
	mux.HandleFunc("/pair", wrap(handlePair))
	mux.HandleFunc("/open", wrap(handleOpen))

	go pollLoop()

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Stderr.WriteString("HanyeLauncher listen failed: " + err.Error() + "\n")
		os.Exit(1)
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	_ = srv.Serve(ln)
}

func pollLoop() {
	client := &http.Client{Timeout: 8 * time.Second}
	for {
		time.Sleep(2 * time.Second)
		mu.Lock()
		origin := cfg.ServerOrigin
		token := cfg.PairToken
		userID := cfg.UserID
		mu.Unlock()
		if origin == "" || token == "" {
			continue
		}
		u := origin + "/api/v1/app-launcher/agent/pull?token=" + url.QueryEscape(token)
		resp, err := client.Get(u)
		if err != nil {
			continue
		}
		var payload struct {
			Ok   bool `json:"ok"`
			Jobs []openReq `json:"jobs"`
			Data struct {
				Jobs []openReq `json:"jobs"`
			} `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		_ = resp.Body.Close()
		jobs := payload.Jobs
		if len(jobs) == 0 {
			jobs = payload.Data.Jobs
		}
		for _, job := range jobs {
			if job.UserID != "" && job.UserID != userID {
				continue
			}
			job.UserID = userID
			job.PairToken = token
			_ = launch(strings.TrimSpace(job.Path), strings.ToLower(strings.TrimSpace(job.OpenMode)))
		}
	}
}
