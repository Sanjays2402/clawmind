import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve the chart relative to the repo root (apps/api -> ../../infra/helm/clawmind).
const chartPath = resolve(__dirname, '..', '..', '..', 'infra', 'helm', 'clawmind');

function helmAvailable(): boolean {
  try {
    execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function render(values: string[] = []): string {
  const args = ['template', 'cm', chartPath, ...values.flatMap((v) => ['--set', v])];
  return execFileSync('helm', args, { encoding: 'utf8' });
}

describe('helm chart hardening', () => {
  if (!existsSync(chartPath) || !helmAvailable()) {
    it.skip('helm CLI or chart not available, skipping render assertions', () => {});
    return;
  }

  it('default render does not emit HPA, PDB, NetworkPolicy, ServiceMonitor, or PrometheusRule', () => {
    const out = render();
    expect(out).not.toMatch(/kind:\s*HorizontalPodAutoscaler/);
    expect(out).not.toMatch(/kind:\s*PodDisruptionBudget/);
    expect(out).not.toMatch(/kind:\s*NetworkPolicy/);
    // Monitoring CRDs are opt-in so the chart installs on clusters
    // without prometheus-operator without erroring on unknown kinds.
    expect(out).not.toMatch(/kind:\s*ServiceMonitor/);
    expect(out).not.toMatch(/kind:\s*PrometheusRule/);
  });

  it('default render pins resource limits on every workload', () => {
    const out = render();
    const deploymentBlocks = out.split(/^---$/m).filter((b) => /kind:\s*Deployment/.test(b));
    expect(deploymentBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of deploymentBlocks) {
      expect(block).toMatch(/resources:/);
      expect(block).toMatch(/limits:/);
      expect(block).toMatch(/requests:/);
    }
  });

  it('default render applies pod and container security context', () => {
    const out = render();
    expect(out).toMatch(/runAsNonRoot:\s*true/);
    expect(out).toMatch(/allowPrivilegeEscalation:\s*false/);
    expect(out).toMatch(/drop:\s*\n\s*-\s*ALL/);
  });

  it('hardened render emits HPA for api and web', () => {
    const out = render([
      'api.autoscaling.enabled=true',
      'web.autoscaling.enabled=true',
    ]);
    const hpaCount = (out.match(/kind:\s*HorizontalPodAutoscaler/g) ?? []).length;
    expect(hpaCount).toBe(2);
  });

  it('hardened render emits PDBs and NetworkPolicies', () => {
    const out = render([
      'api.pdb.enabled=true',
      'web.pdb.enabled=true',
      'embed.pdb.enabled=true',
      'networkPolicy.enabled=true',
    ]);
    const pdbCount = (out.match(/kind:\s*PodDisruptionBudget/g) ?? []).length;
    const npCount = (out.match(/kind:\s*NetworkPolicy/g) ?? []).length;
    expect(pdbCount).toBe(3);
    expect(npCount).toBe(3);
  });

  it('monitoring render emits a ServiceMonitor wired to /metrics on the api service', () => {
    const out = render([
      'monitoring.serviceMonitor.enabled=true',
      'monitoring.serviceMonitor.labels.release=kube-prometheus-stack',
    ]);
    const smBlock = out
      .split(/^---$/m)
      .find((b) => /kind:\s*ServiceMonitor/.test(b));
    expect(smBlock, 'ServiceMonitor rendered').toBeTruthy();
    // Wired to the api Service via the app label and the named http port.
    expect(smBlock!).toMatch(/matchLabels:[\s\S]*?app:\s*clawmind-api/);
    expect(smBlock!).toMatch(/port:\s*http/);
    expect(smBlock!).toMatch(/path:\s*\/metrics/);
    // Selector label flows through so the Prometheus instance picks it up.
    expect(smBlock!).toMatch(/release:\s*kube-prometheus-stack/);
  });

  it('api service exposes a named http port so ServiceMonitor can target it', () => {
    const out = render();
    const svcBlock = out
      .split(/^---$/m)
      .find((b) => /kind:\s*Service\b/.test(b) && /-api\b/.test(b));
    expect(svcBlock, 'api Service present').toBeTruthy();
    expect(svcBlock!).toMatch(/name:\s*http/);
  });

  it('monitoring render emits a PrometheusRule with the documented on-call alerts', () => {
    const out = render([
      'monitoring.prometheusRule.enabled=true',
      'monitoring.prometheusRule.labels.role=alerts',
    ]);
    const prBlock = out
      .split(/^---$/m)
      .find((b) => /kind:\s*PrometheusRule/.test(b));
    expect(prBlock, 'PrometheusRule rendered').toBeTruthy();
    // Every alert documented in README#on-call must be present.
    for (const alert of [
      'ClawmindApiDown',
      'ClawmindApiHighErrorRate',
      'ClawmindApiAskLatencyHigh',
      'ClawmindApiReadinessFlapping',
    ]) {
      expect(prBlock!).toMatch(new RegExp(`alert:\\s*${alert}\\b`));
    }
    // Severity labels are set so Alertmanager routing works out of the box.
    expect(prBlock!).toMatch(/severity:\s*critical/);
    expect(prBlock!).toMatch(/severity:\s*warning/);
    expect(prBlock!).toMatch(/role:\s*alerts/);
  });

  it('api livenessProbe targets /live so a flaky embed cannot kill the pod', () => {
    const out = render();
    const apiBlock = out
      .split(/^---$/m)
      .find((b) => /kind:\s*Deployment/.test(b) && /-api\b/.test(b));
    expect(apiBlock, 'api Deployment present').toBeTruthy();
    expect(apiBlock!).toMatch(/livenessProbe:[\s\S]*?path:\s*\/live/);
    expect(apiBlock!).toMatch(/readinessProbe:[\s\S]*?path:\s*\/ready/);
  });
});
