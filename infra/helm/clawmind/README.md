# ClawMind Helm Chart

Skeleton chart that ships three deployments (api, web, embed), a PVC for LanceDB, and an optional ingress.

```bash
helm install clawmind ./infra/helm/clawmind --values infra/helm/clawmind/values.yaml
```

Tweak `values.yaml` for replicas, persistence size, ingress host.
