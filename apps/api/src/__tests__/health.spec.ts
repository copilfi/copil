import type { Request, Response, NextFunction } from 'express';
import App from '../app';

describe('API health endpoint', () => {
  it('responds with service status information', async () => {
    const app = new App();
    const routerStack = (app.express as any)?._router?.stack ?? [];

    const healthLayer = routerStack.find((layer: any) => layer.route?.path === '/health');
    expect(healthLayer).toBeDefined();

    const getHandler = healthLayer.route.stack.find((layer: any) => layer.method === 'get')?.handle;
    expect(typeof getHandler).toBe('function');

    const fakeReq = { method: 'GET', path: '/health' } as Request;
    const responseState: { statusCode?: number; body?: unknown } = {};

    const fakeRes: Partial<Response> = {
      status(code: number) {
        responseState.statusCode = code;
        return this as Response;
      },
      json(payload: unknown) {
        responseState.body = payload;
        return this as Response;
      }
    };

    await Promise.resolve(
      getHandler(
        fakeReq,
        fakeRes as Response,
        (() => {}) as NextFunction
      )
    );

    expect(responseState.statusCode).toBe(200);
    expect(responseState.body).toMatchObject({ status: 'OK' });
  });
});
