# UFW baseline for Qubite

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw limit 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Notes:

- Do not open the Node.js port publicly.
- If you use another SSH port, allow and limit that port instead of `22/tcp`.
- For ICMP/ping rate limiting, prefer nftables from [`nftables-qubite.nft`](/home/kirill/programing/qubite/deploy/firewall/nftables-qubite.nft).
