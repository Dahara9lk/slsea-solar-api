'use strict';

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const openapi = require('./docs/openapi');
const { getDb } = require('./db/connection');
const authRouter = require('./routes/auth');
const writeRouter = require('./routes/write');
const readRouter = require('./routes/read');
const { errorHandler, notFoundHandler } = require('./middleware/errors');

function healthHandler(req, res, next) {
  try {
    const db = getDb();
    const readings = db.prepare(`SELECT COUNT(*) AS count FROM generation_readings`).get().count;
    const installations = db
      .prepare(`SELECT COUNT(*) AS count FROM solar_installations`)
      .get().count;
    res.json({
      status: 'ok',
      database: 'up',
      readings,
      installations,
      uptime_s: Math.round(process.uptime() * 10) / 10,
    });
  } catch (error) {
    next(error);
  }
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', healthHandler);
  app.get('/openapi.json', (req, res) => {
    res.json(openapi);
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapi, {
      customSiteTitle: 'SLSEA Solar Generation API',
      swaggerOptions: { persistAuthorization: true },
    })
  );

  app.use('/auth', authRouter);
  app.use(writeRouter);
  app.use(readRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
module.exports.config = config;
