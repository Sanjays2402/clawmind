import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export async function startTracing(opts: { enabled: boolean; endpoint: string; serviceName: string; version?: string }) {
  if (!opts.enabled || sdk) return;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.version ?? '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${opts.endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  await sdk.start();
}

export async function stopTracing() {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
