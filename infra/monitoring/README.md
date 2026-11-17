# Monitoring files for your existing stack (A18)

Copy-only proposals. Nothing here is applied, and nothing needs a new service.

| File                    | Goes to                        | Purpose                                                            |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `mise-backup.rules.yml` | Prometheus rules directory     | Dump older than 26 h, last run failed, dump size halved            |
| `blackbox-targets.yml`  | Prometheus `file_sd` directory | Probe targets: Mise `/api/v1/health/ready`, Authelia `/api/health` |
| `mise-probes.rules.yml` | Prometheus rules directory     | MiseDown, AutheliaDown, certificate expiry                         |

The dump script writes `mise_backup_*` metrics to the file named by `METRICS_FILE`; point that at a `*.prom` file in
your node_exporter textfile-collector directory.

Scrape job for `prometheus.yml` (use your blackbox exporter address and module):

```yaml
scrape_configs:
  - job_name: mise-blackbox
    metrics_path: /probe
    params: { module: [http_2xx] }
    file_sd_configs:
      - files: [/etc/prometheus/targets/blackbox-targets.yml]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

Alerts carry `service: mise|authelia` and `severity` labels so your existing Alertmanager routes can match on them.
