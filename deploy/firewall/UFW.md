# Базовый UFW-профиль для Qubite

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

## Примечания

- Не открывайте наружу Node.js порт.
- Если SSH работает на другом порту, разрешайте и лимитируйте именно его.
- Для более тонкой сетевой фильтрации и rate limiting смотрите `nftables-qubite.nft`.
