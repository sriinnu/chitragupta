# Common Ports Reference

## Well-Known Ports (0–1023)

| Port | Service | Protocol | Notes |
|------|---------|----------|-------|
| 20   | FTP Data | TCP | Active mode data transfer |
| 21   | FTP Control | TCP | File transfer |
| 22   | SSH | TCP | Secure shell, SCP, SFTP |
| 23   | Telnet | TCP | Insecure — flag if open |
| 25   | SMTP | TCP | Email relay |
| 53   | DNS | TCP/UDP | Domain name resolution |
| 67   | DHCP Server | UDP | Dynamic host configuration |
| 68   | DHCP Client | UDP | |
| 80   | HTTP | TCP | Web server |
| 110  | POP3 | TCP | Email retrieval |
| 123  | NTP | UDP | Time synchronization |
| 143  | IMAP | TCP | Email access |
| 161  | SNMP | UDP | Network management |
| 389  | LDAP | TCP | Directory services |
| 443  | HTTPS | TCP | Encrypted web |
| 445  | SMB | TCP | Windows file sharing |
| 465  | SMTPS | TCP | Encrypted email relay |
| 514  | Syslog | UDP | Log collection |
| 587  | SMTP Submission | TCP | Email submission |
| 636  | LDAPS | TCP | Encrypted directory |
| 993  | IMAPS | TCP | Encrypted email access |
| 995  | POP3S | TCP | Encrypted email retrieval |

## Registered Ports (1024–49151)

| Port | Service | Notes |
|------|---------|-------|
| 1433 | MSSQL | Microsoft SQL Server |
| 1521 | Oracle DB | Oracle database |
| 2049 | NFS | Network file system |
| 2181 | ZooKeeper | Distributed coordination |
| 3000 | Dev servers | Node.js, Grafana, etc. |
| 3141 | Chitragupta | Our HTTP API |
| 3306 | MySQL | MySQL/MariaDB |
| 3389 | RDP | Remote desktop |
| 4222 | NATS | Message broker |
| 5000 | Flask/Synology | Python dev, NAS admin |
| 5432 | PostgreSQL | Postgres database |
| 5672 | AMQP | RabbitMQ |
| 5900 | VNC | Remote desktop |
| 6379 | Redis | In-memory store |
| 6443 | Kubernetes API | K8s control plane |
| 7788 | Smriti | Our session server |
| 8080 | HTTP Alt | Proxy, dev servers |
| 8443 | HTTPS Alt | Alternative HTTPS |
| 8888 | Jupyter | Notebook server |
| 9090 | Prometheus | Monitoring |
| 9092 | Kafka | Message streaming |
| 9200 | Elasticsearch | Search engine |
| 11211 | Memcached | Caching |
| 15672 | RabbitMQ Mgmt | Management UI |
| 18369 | Vaayu Gateway | Our AI gateway |
| 27017 | MongoDB | Document database |

## Security Flags

| Condition | Severity | Action |
|-----------|----------|--------|
| Port 23 (Telnet) open | HIGH | Flag — insecure protocol |
| Port 445 (SMB) on public IP | HIGH | Flag — ransomware vector |
| Port 3389 (RDP) on public IP | HIGH | Flag — brute-force target |
| Database ports on public IP | HIGH | Flag — direct DB exposure |
| Port 22 on default | INFO | Suggest non-standard port |
| Port 161 (SNMP) v1/v2c | MEDIUM | Flag — community string auth |
| Any port with no TLS | MEDIUM | Flag if carrying sensitive data |

## TTL-Based OS Fingerprinting

| TTL Range | Likely OS |
|-----------|-----------|
| 64 | Linux, macOS, FreeBSD |
| 128 | Windows |
| 255 | Cisco IOS, Solaris, AIX |
| 60 | Some embedded devices |
