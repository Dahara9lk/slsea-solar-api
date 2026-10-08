'use strict';

const ANALYST_READ = 'analyst-read';
const DEVICE_WRITE = 'installation-write';

function errorResponse(description) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

const UNAUTHORIZED = errorResponse(
  'Missing, malformed, or expired bearer token (AUTHENTICATION_REQUIRED / INVALID_TOKEN)'
);
const FORBIDDEN_SCOPE = errorResponse('The token does not carry the scope this endpoint requires');
const FORBIDDEN_JURISDICTION = errorResponse(
  'The resource exists but lies outside the jurisdiction assigned to the token'
);
const NOT_FOUND = errorResponse('No resource matches the supplied identifier');
const VALIDATION_ERROR = errorResponse('A path, query, or body field failed validation');

function jsonBody(schema, required = true) {
  return { required, content: { 'application/json': { schema } } };
}

function jsonResponse(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

const PAGE_PARAM = {
  name: 'page',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, default: 1 },
  description: 'One-based page number.',
};
const LIMIT_PARAM = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
  description: 'Number of records per page (maximum 200).',
};
const ANALYTICAL_LIMIT_PARAM = {
  ...LIMIT_PARAM,
  schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  description: 'Number of readings per page (default 50, maximum 200).',
};
const ORDER_PARAM = {
  name: 'order',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  description: 'Sort direction applied to the timestamp column.',
};
const SORT_PARAM = {
  name: 'sort',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['timestamp'], default: 'timestamp' },
  description: 'Only the timestamp column is sortable.',
};
const START_TIME_PARAM = {
  name: 'start_time',
  in: 'query',
  required: false,
  schema: { type: 'string', format: 'date-time' },
  description: 'Inclusive lower bound, ISO-8601 UTC (must end in Z).',
};
const END_TIME_PARAM = {
  name: 'end_time',
  in: 'query',
  required: false,
  schema: { type: 'string', format: 'date-time' },
  description: 'Inclusive upper bound, ISO-8601 UTC (must end in Z).',
};
const INSTALLATION_ID_PARAM = {
  name: 'installation-id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Solar installation identifier.',
};
const DISTRICT_ID_PARAM = {
  name: 'district-id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'District identifier.',
};
const PROVINCE_ID_PARAM = {
  name: 'province-id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Province identifier.',
};
const SUBSTATION_ID_PARAM = {
  name: 'substation-id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Grid substation identifier.',
};

const READ_SECURITY = [{ AnalystRead: [] }];
const READ_RESPONSES = (extra = {}) => ({
  200: extra['200'],
  400: VALIDATION_ERROR,
  401: UNAUTHORIZED,
  403: FORBIDDEN_JURISDICTION,
  404: NOT_FOUND,
  ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== '200')),
});

const ETAG_HEADER = {
  description: 'Strong entity tag derived from the resource payload.',
  schema: { type: 'string', example: '"4acc71e0547112eb432f0a36fb1924c4a738cb49"' },
};
const IF_NONE_MATCH_PARAM = {
  name: 'If-None-Match',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description: 'When it matches the current ETag (a quoted tag, a weak `W/` tag, a comma-separated list, or `*`), the server returns 304.',
};
const NOT_MODIFIED = {
  description: 'The supplied If-None-Match matched; the resource is unchanged. Empty body, no Content-Type.',
  headers: { ETag: ETAG_HEADER },
};
function cachedJsonResponse(description, schema) {
  return {
    description,
    headers: { ETag: ETAG_HEADER },
    content: { 'application/json': { schema } },
  };
}
const CONDITIONAL_READ_RESPONSES = (description, schema) =>
  READ_RESPONSES({ 200: cachedJsonResponse(description, schema), 304: NOT_MODIFIED });

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SLSEA Solar Generation API',
    version: '1.0.0',
    description: [
      'Read and write access to Sri Lanka Sustainable Energy Authority rooftop solar telemetry.',
      '',
      '## Authorisation model',
      '',
      'The API implements a strict write-read split. Two token scopes exist and never cross:',
      '',
      `- \`${ANALYST_READ}\` - SLSEA staff read data, automatically filtered to the jurisdiction carried by their token (\`national\`, \`province\`, or \`district\`).`,
      `- \`${DEVICE_WRITE}\` - an IoT installation meter writes its own readings only. The token's \`installation_id\` claim must equal the \`installation-id\` in the URI.`,
      '',
      'Reaching outside your jurisdiction returns **403 JURISDICTION_FORBIDDEN**; an unknown identifier returns **404 RESOURCE_NOT_FOUND**.',
      '',
      '## Timestamps',
      '',
      'Every timestamp is an ISO-8601 instant in UTC with a trailing `Z`. Because the format is fixed-width, lexicographic ordering equals chronological ordering, so `sort=timestamp` is always correct.',
      '',
      '## Conditional GET',
      '',
      'Single-resource endpoints (province, district, substation, solar installation) return a strong `ETag` header. Send it back in `If-None-Match` to receive **304 Not Modified** with an empty body when the resource has not changed.',
      '',
      '## Interactive documentation',
      '',
      'Swagger UI is served at `/api-docs` (alias `/docs`); this document is available unauthenticated at `/openapi.json`.',
      '',
      '## Demo tokens',
      '',
      'This build ships without an identity provider. `POST /auth/token` and `POST /auth/device-token` mint tokens for the seeded demo identities (no password check). The server also prints a preset token for a national analyst, a Western province analyst, a Colombo district analyst, and the first installation meter at start-up.',
    ].join('\n'),
    license: { name: 'Academic coursework - NB6007CEM' },
  },
  servers: [{ url: '/', description: 'Root base path (no version prefix)' }],
  tags: [
    { name: 'Operational', description: 'Liveness and documentation.' },
    { name: 'Authentication', description: 'Demo token issuance for analysts and devices.' },
    { name: 'Geography', description: 'Province, district, and grid substation hierarchy.' },
    { name: 'Installations', description: 'Solar installation assets and their telemetry.' },
    { name: 'Telemetry', description: 'Append-only generation readings (write path).' },
  ],
  security: READ_SECURITY,
  paths: {
    '/health': {
      get: {
        tags: ['Operational'],
        summary: 'Liveness probe',
        description: 'Public. Reports process and database health without exposing data.',
        security: [],
        responses: {
          200: jsonResponse('Service is healthy', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              database: { type: 'string', example: 'up' },
              readings: { type: 'integer', example: 147841 },
              installations: { type: 'integer', example: 220 },
              uptime_s: { type: 'number', example: 12.4 },
            },
          }),
        },
      },
    },
    '/auth/token': {
      post: {
        tags: ['Authentication'],
        summary: 'Issue an analyst read token',
        description:
          'Public. Resolves a seeded SLSEA user and returns an analyst-read JWT carrying that user jurisdiction. No password is required in this demo build.',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'chamara.alwis@slsea.gov.lk' },
            employee_id: { type: 'string', example: 'SLSEA-0012' },
          },
          anyOf: [{ required: ['email'] }, { required: ['employee_id'] }],
        }),
        responses: {
          200: jsonResponse('Token issued', { $ref: '#/components/schemas/AnalystToken' }),
          400: VALIDATION_ERROR,
          404: NOT_FOUND,
        },
      },
    },
    '/auth/device-token': {
      post: {
        tags: ['Authentication'],
        summary: 'Issue an installation write token',
        description:
          'Public. Returns an installation-write JWT bound to a single solar installation meter.',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            installation_id: { type: 'integer', minimum: 1, example: 1 },
            meter_id: { type: 'string', example: 'SL-M-1001' },
          },
          anyOf: [{ required: ['installation_id'] }, { required: ['meter_id'] }],
        }),
        responses: {
          200: jsonResponse('Token issued', { $ref: '#/components/schemas/DeviceToken' }),
          400: VALIDATION_ERROR,
          404: NOT_FOUND,
        },
      },
    },
    '/provinces': {
      get: {
        tags: ['Geography'],
        summary: 'List provinces visible to the caller',
        description:
          'A national token sees all nine provinces, a province token sees its own province, and a district token sees its parent province.',
        parameters: [PAGE_PARAM, LIMIT_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('Paginated provinces', {
            allOf: [
              { $ref: '#/components/schemas/PaginationEnvelope' },
              { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Province' } } } },
            ],
          }),
        }),
      },
    },
    '/provinces/{province-id}': {
      get: {
        tags: ['Geography'],
        summary: 'Retrieve one province',
        description: 'Conditional GET: honours If-None-Match and returns 304 when the province is unchanged.',
        parameters: [PROVINCE_ID_PARAM, IF_NONE_MATCH_PARAM],
        responses: CONDITIONAL_READ_RESPONSES('The province', { $ref: '#/components/schemas/Province' }),
      },
    },
    '/districts': {
      get: {
        tags: ['Geography'],
        summary: 'List districts visible to the caller',
        description: 'Filtered by the caller jurisdiction: a district token receives only its own district.',
        parameters: [PAGE_PARAM, LIMIT_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('Paginated districts', {
            allOf: [
              { $ref: '#/components/schemas/PaginationEnvelope' },
              { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/District' } } } },
            ],
          }),
        }),
      },
    },
    '/districts/{district-id}': {
      get: {
        tags: ['Geography'],
        summary: 'Retrieve one district',
        description: 'Conditional GET: honours If-None-Match and returns 304 when the district is unchanged.',
        parameters: [DISTRICT_ID_PARAM, IF_NONE_MATCH_PARAM],
        responses: CONDITIONAL_READ_RESPONSES('The district', { $ref: '#/components/schemas/District' }),
      },
    },
    '/districts/{district-id}/generation-summary': {
      get: {
        tags: ['Geography'],
        summary: 'Generation summary for a district',
        description:
          'Processing resource. Sums the most recent reading of every installation for current output and totals today energy.',
        parameters: [DISTRICT_ID_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('District generation summary', { $ref: '#/components/schemas/GenerationSummary' }),
        }),
      },
    },
    '/substations': {
      get: {
        tags: ['Geography'],
        summary: 'List grid substations visible to the caller',
        parameters: [PAGE_PARAM, LIMIT_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('Paginated grid substations', {
            allOf: [
              { $ref: '#/components/schemas/PaginationEnvelope' },
              { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/GridSubstation' } } } },
            ],
          }),
        }),
      },
    },
    '/substations/{substation-id}': {
      get: {
        tags: ['Geography'],
        summary: 'Retrieve one grid substation',
        description: 'Conditional GET: honours If-None-Match and returns 304 when the substation is unchanged.',
        parameters: [SUBSTATION_ID_PARAM, IF_NONE_MATCH_PARAM],
        responses: CONDITIONAL_READ_RESPONSES('The grid substation', { $ref: '#/components/schemas/GridSubstation' }),
      },
    },
    '/solar-installations': {
      get: {
        tags: ['Installations'],
        summary: 'List solar installations visible to the caller',
        description:
          'Every record is resolved through the installation to substation to district to province chain, then filtered to the caller jurisdiction.',
        parameters: [
          PAGE_PARAM,
          LIMIT_PARAM,
          {
            name: 'province_id',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1 },
          },
          { name: 'district_id', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
          { name: 'substation_id', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
          {
            name: 'site_type',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['residential_rooftop', 'commercial_rooftop', 'industrial_rooftop', 'ground_mount'],
            },
          },
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['active', 'maintenance', 'decommissioned'] } },
          {
            name: 'q',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Case-insensitive partial match on installation name or meter_id.',
          },
        ],
        responses: READ_RESPONSES({
          200: jsonResponse('Paginated solar installations', {
            allOf: [
              { $ref: '#/components/schemas/PaginationEnvelope' },
              {
                type: 'object',
                properties: { data: { type: 'array', items: { $ref: '#/components/schemas/SolarInstallation' } } },
              },
            ],
          }),
        }),
      },
    },
    '/solar-installations/{installation-id}': {
      get: {
        tags: ['Installations'],
        summary: 'Retrieve one solar installation',
        description: 'Conditional GET: honours If-None-Match and returns 304 when the installation is unchanged.',
        parameters: [INSTALLATION_ID_PARAM, IF_NONE_MATCH_PARAM],
        responses: CONDITIONAL_READ_RESPONSES('The solar installation', { $ref: '#/components/schemas/SolarInstallation' }),
      },
    },
    '/solar-installations/{installation-id}/readings': {
      get: {
        tags: ['Telemetry'],
        summary: 'Historical readings for an installation',
        description:
          'Scoped analytical collection. Supports date-window filtering, whitelisted sorting, and pagination.',
        parameters: [
          INSTALLATION_ID_PARAM,
          PAGE_PARAM,
          ANALYTICAL_LIMIT_PARAM,
          START_TIME_PARAM,
          END_TIME_PARAM,
          SORT_PARAM,
          ORDER_PARAM,
        ],
        responses: READ_RESPONSES({
          200: jsonResponse('Paginated generation readings', {
            allOf: [
              { $ref: '#/components/schemas/PaginationEnvelope' },
              {
                type: 'object',
                properties: { data: { type: 'array', items: { $ref: '#/components/schemas/GenerationReading' } } },
              },
            ],
          }),
        }),
      },
      post: {
        tags: ['Telemetry'],
        summary: 'Append a generation reading',
        description: [
          'Device write path. The token must carry the `installation-write` scope and its',
          '`installation_id` claim must equal the `installation_id` path parameter, otherwise 403',
          '`FORBIDDEN` with `message: "Installation ID mismatch"` and',
          '`detail: { expected, received }` is returned **before** any existence check is performed.',
          'A repeated timestamp for the same installation is rejected with 409 `DUPLICATE_READING`.',
        ].join(' '),
        security: [{ DeviceWrite: [] }],
        parameters: [INSTALLATION_ID_PARAM],
        requestBody: jsonBody({ $ref: '#/components/schemas/GenerationReadingInput' }),
        responses: {
          201: {
            description: 'Reading appended. The Location header addresses the new reading.',
            headers: {
              Location: {
                description: 'Canonical URI of the created reading.',
                schema: { type: 'string', example: '/solar-installations/1/readings/147841' },
              },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerationReading' } } },
          },
          400: VALIDATION_ERROR,
          401: UNAUTHORIZED,
          403: errorResponse(
            'INSUFFICIENT_SCOPE (analyst token) or FORBIDDEN / "Installation ID mismatch" (token bound to another installation)'
          ),
          404: NOT_FOUND,
          409: errorResponse('A reading already exists for this installation and timestamp'),
        },
      },
    },
    '/solar-installations/{installation-id}/readings/{reading-id}': {
      get: {
        tags: ['Telemetry'],
        summary: 'Retrieve a single generation reading',
        description: 'The resource addressed by the Location header of a 201 response.',
        parameters: [INSTALLATION_ID_PARAM, { name: 'reading-id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: READ_RESPONSES({
          200: jsonResponse('The generation reading', { $ref: '#/components/schemas/GenerationReading' }),
        }),
      },
    },
    '/solar-installations/{installation-id}/last-reading': {
      get: {
        tags: ['Telemetry'],
        summary: 'Most recent reading for an installation',
        description: 'Derived resource. Returns 404 when the installation has no readings yet.',
        parameters: [INSTALLATION_ID_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('The most recent reading', { $ref: '#/components/schemas/GenerationReading' }),
        }),
      },
    },
    '/solar-installations/{installation-id}/composite': {
      get: {
        tags: ['Installations'],
        summary: 'Installation bundled with its most recent reading',
        description: 'Derived resource. `last_reading` is null when the installation has no telemetry yet.',
        parameters: [INSTALLATION_ID_PARAM],
        responses: READ_RESPONSES({
          200: jsonResponse('Installation and last reading', { $ref: '#/components/schemas/InstallationComposite' }),
        }),
      },
    },
  },
  components: {
    securitySchemes: {
      AnalystRead: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: `JWT with \`scope: "${ANALYST_READ}"\` and a \`jurisdiction_type\`/\`jurisdiction_id\` claim pair.`,
      },
      DeviceWrite: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: `JWT with \`scope: "${DEVICE_WRITE}"\` and an \`installation_id\` claim.`,
      },
    },
    parameters: { PAGE_PARAM, LIMIT_PARAM },
    schemas: {
      Error: {
        type: 'object',
        required: ['code', 'message', 'detail'],
        properties: {
          code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
          message: { type: 'string', example: 'Solar installation not found' },
          detail: { type: 'object', additionalProperties: true, example: { installation_id: '99999' } },
        },
      },
      PaginationEnvelope: {
        type: 'object',
        required: ['data', 'total_count', 'next', 'previous'],
        properties: {
          data: { type: 'array' },
          total_count: { type: 'integer', example: 220 },
          next: {
            type: 'string',
            nullable: true,
            example: 'http://localhost:3000/solar-installations?page=2&limit=20',
          },
          previous: { type: 'string', nullable: true, example: null },
        },
      },
      Province: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          code: { type: 'string', example: 'WP' },
          name: { type: 'string', example: 'Western' },
          district_count: { type: 'integer', example: 3 },
        },
      },
      District: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          code: { type: 'string', example: 'COL' },
          name: { type: 'string', example: 'Colombo' },
          province_id: { type: 'integer', example: 1 },
          province_name: { type: 'string', nullable: true, example: 'Western' },
          province_code: { type: 'string', nullable: true, example: 'WP' },
          substation_count: { type: 'integer', example: 2 },
          installation_count: { type: 'integer', example: 24 },
          total_capacity_kw: { type: 'number', example: 1543.6 },
        },
      },
      GridSubstation: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          code: { type: 'string', example: 'SS-WP-COL-01' },
          name: { type: 'string', example: 'Colombo Fort 132kV Substation' },
          district_id: { type: 'integer', example: 1 },
          district_name: { type: 'string', example: 'Colombo' },
          province_id: { type: 'integer', example: 1 },
          voltage_level_kv: { type: 'number', example: 132 },
          commissioned_on: { type: 'string', format: 'date', example: '2015-06-18' },
          installation_count: { type: 'integer', example: 12 },
        },
      },
      SolarInstallation: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          meter_id: { type: 'string', example: 'SL-M-1001' },
          name: { type: 'string', example: 'Colombo Residential Rooftop 001' },
          site_type: {
            type: 'string',
            enum: ['residential_rooftop', 'commercial_rooftop', 'industrial_rooftop', 'ground_mount'],
          },
          capacity_kw: { type: 'number', example: 9.59 },
          status: { type: 'string', enum: ['active', 'maintenance', 'decommissioned'] },
          commissioned_on: { type: 'string', format: 'date' },
          substation: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              voltage_level_kv: { type: 'number' },
            },
          },
          district: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' }, code: { type: 'string' } },
          },
          province: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' }, code: { type: 'string' } },
          },
        },
      },
      GenerationReading: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 147841 },
          installation_id: { type: 'integer', example: 1 },
          timestamp: { type: 'string', format: 'date-time', example: '2026-10-05T18:00:00Z' },
          power_kw: { type: 'number', example: 6.2 },
          energy_kwh: { type: 'number', example: 1.55 },
          voltage: { type: 'number', example: 231.4 },
        },
      },
      GenerationReadingInput: {
        type: 'object',
        required: ['timestamp', 'power_kw', 'energy_kwh', 'voltage'],
        properties: {
          timestamp: {
            type: 'string',
            format: 'date-time',
            pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$',
            example: '2026-10-05T18:00:00Z',
          },
          power_kw: { type: 'number', minimum: 0, maximum: 500, example: 6.2 },
          energy_kwh: { type: 'number', minimum: 0, example: 1.55 },
          voltage: { type: 'number', minimum: 180, maximum: 280, example: 231.4 },
        },
      },
      GenerationSummary: {
        type: 'object',
        required: ['district_id', 'district_name', 'current_total_power_kw', 'today_total_energy_kwh', 'installation_count'],
        properties: {
          district_id: { type: 'integer', example: 1 },
          district_name: { type: 'string', example: 'Colombo' },
          current_total_power_kw: { type: 'number', example: 132.47 },
          today_total_energy_kwh: { type: 'number', example: 1183.62 },
          installation_count: { type: 'integer', example: 24 },
        },
      },
      InstallationComposite: {
        type: 'object',
        properties: {
          installation: { $ref: '#/components/schemas/SolarInstallation' },
          last_reading: {
            allOf: [{ $ref: '#/components/schemas/GenerationReading' }],
            nullable: true,
          },
        },
      },
      AnalystToken: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'integer', example: 7200 },
          scope: { type: 'string', example: ANALYST_READ },
          subject: {
            type: 'object',
            properties: {
              user_id: { type: 'integer' },
              employee_id: { type: 'string', example: 'SLSEA-0012' },
              name: { type: 'string' },
              email: { type: 'string' },
              role: { type: 'string' },
              jurisdiction_type: { type: 'string', enum: ['national', 'province', 'district'] },
              jurisdiction_id: { type: 'integer', nullable: true },
            },
          },
        },
      },
      DeviceToken: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'integer', example: 7200 },
          scope: { type: 'string', example: DEVICE_WRITE },
          subject: {
            type: 'object',
            properties: {
              installation_id: { type: 'integer', example: 1 },
              meter_id: { type: 'string', example: 'SL-M-1001' },
              name: { type: 'string' },
            },
          },
        },
      },
    },
  },
};
