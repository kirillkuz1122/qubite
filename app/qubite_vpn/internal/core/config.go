package core

import (
	"encoding/json"
	"qubite-vpn/internal/api"
)

// BuildSingboxConfig generates a sing-box JSON config for NaiveProxy connection.
func BuildSingboxConfig(session *api.Session, routing *api.RoutingProfile) ([]byte, error) {
	// DNS config: proxy-dns for tunneled, direct-dns for Russian domains
	dns := map[string]interface{}{
		"servers": []map[string]interface{}{
			{
				"tag":     "proxy-dns",
				"address": "https://1.1.1.1/dns-query",
				"detour":  "proxy-out",
			},
			{
				"tag":     "direct-dns",
				"address": "https://77.88.8.8/dns-query",
				"detour":  "direct-out",
			},
		},
		"rules": []map[string]interface{}{
			{
				"rule_set": []string{"ru-direct"},
				"server":   "direct-dns",
			},
		},
		"final": "proxy-dns",
	}

	// Inbound: TUN interface
	inbounds := []map[string]interface{}{
		{
			"type":                     "tun",
			"tag":                      "tun-in",
			"interface_name":           "qubite-tun",
			"inet4_address":            "172.19.0.1/30",
			"inet6_address":            "fdfe:dcba:9876::1/126",
			"auto_route":              true,
			"strict_route":            true,
			"stack":                   "system",
			"sniff":                   true,
			"sniff_override_destination": true,
		},
	}

	// Outbound: NaiveProxy
	outbounds := []map[string]interface{}{
		{
			"type": "http",
			"tag":  "proxy-out",
			"server":   session.Transport.Host,
			"server_port": session.Transport.Port,
			"username":    session.Credential.Username,
			"password":    session.Credential.Password,
			"tls": map[string]interface{}{
				"enabled":     true,
				"server_name": session.Transport.Host,
			},
		},
		{
			"type": "direct",
			"tag":  "direct-out",
		},
		{
			"type": "block",
			"tag":  "block-out",
		},
		{
			"type": "dns",
			"tag":  "dns-out",
		},
	}

	// Route rules
	rules := []map[string]interface{}{
		{"protocol": "dns", "outbound": "dns-out"},
		// Local networks direct
		{
			"ip_cidr": []string{
				"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
				"127.0.0.0/8", "169.254.0.0/16",
				"fc00::/7", "fe80::/10", "::1/128",
			},
			"outbound": "direct-out",
		},
	}

	// Add rules from routing profile
	if routing != nil {
		for _, rule := range routing.Rules {
			outbound := "proxy-out"
			if rule.Action == "direct" {
				outbound = "direct-out"
			} else if rule.Action == "block" {
				outbound = "block-out"
			}
			r := map[string]interface{}{"outbound": outbound}
			if len(rule.Domains) > 0 {
				r["domain_suffix"] = rule.Domains
			}
			if len(rule.IPs) > 0 {
				r["ip_cidr"] = rule.IPs
			}
			rules = append(rules, r)
		}
	}

	// Russian domains go direct
	rules = append(rules, map[string]interface{}{
		"rule_set": []string{"ru-direct"},
		"outbound": "direct-out",
	})

	route := map[string]interface{}{
		"rules": rules,
		"rule_set": []map[string]interface{}{
			{
				"tag":    "ru-direct",
				"type":   "inline",
				"rules": []map[string]interface{}{
					{"domain_suffix": []string{".ru", ".xn--p1ai", ".su"}},
				},
			},
		},
		"final":                   "proxy-out",
		"auto_detect_interface":   true,
	}

	config := map[string]interface{}{
		"log": map[string]interface{}{
			"level": "warn",
		},
		"dns":       dns,
		"inbounds":  inbounds,
		"outbounds": outbounds,
		"route":     route,
	}

	return json.MarshalIndent(config, "", "  ")
}
