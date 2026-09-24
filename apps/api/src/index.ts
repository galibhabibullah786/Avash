import { Hono } from 'hono';
import { handleError, buildGenericErrorBody } from '@avash/logger';
import type { AppEnv } from './types';
import { requestId } from './middleware/request-id';
import { securityHeaders } from './middleware/security-headers';
import { corsMiddleware } from './middleware/cors';
import { health } from './routes/health';
import { weather } from './routes/weather';
import { riskMap, riskDetail } from './routes/risk-map';
import { symptomCheck } from './routes/symptom-check';
import { reports } from './routes/reports';
import { resources } from './routes/resources';
import { adminUsers } from './routes/admin-users';
import { uploads } from './routes/uploads';
import { alerts } from './routes/alerts';
import { announcements } from './routes/announcements';
import { auditLog } from './routes/audit-log';

const app = new Hono<AppEnv>();

// Middleware chain order, per docs/standards/backend.md:
// request-id -> security-headers -> cors -> routes -> onError.
app.use('*', requestId());
app.use('*', securityHeaders());
app.use('*', corsMiddleware());

app.get('/', (c) =>
  c.json({
    message: 'Welcome to Avash API',
    requestId: c.get('requestId'),
  })
);

app.route('/health', health);
// Public reads, cors+headers only — no rate-limit middleware (§6 amendment;
// the §6 discrepancy between the 60/min claim and this chain is flagged,
// not resolved, pending the security-hardening slice).
app.route('/api/weather', weather);
app.route('/api/risk-map', riskMap);
app.route('/api/risk', riskDetail);
app.route('/api/symptom-check', symptomCheck); // rate-limit, quota-guard
app.route('/api/reports', reports); // turnstile+rate-limit (POST), auth+rate-limit (PATCH verify)
app.route('/api/resources', resources); // public GETs; auth+rate-limit on PATCH blood/:id
app.route('/api/admin/users', adminUsers); // auth(roles:manage)+rate-limit on every method
app.route('/api/uploads/signature', uploads); // auth (any role)+rate-limit; signed direct-to-Cloudinary (ADR-015)
app.route('/api/alerts', alerts); // auth+rate-limit; CRUD only, push send lives in ml/serving/predict.py (decision C)
app.route('/api/announcements', announcements); // auth(reports:moderate)+rate-limit (POST/DELETE), auth+rate-limit (GET, decision H)
app.route('/api/admin/audit-log', auditLog); // auth(roles:manage)+rate-limit

app.notFound((c) => c.json(buildGenericErrorBody(c.get('requestId')), 404));

app.onError((error, c) => {
  const body = handleError(error, c.get('requestId'));
  return c.json(body, 500);
});

export default app;
