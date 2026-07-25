import { ServiceUnavailableException } from '@nestjs/common';
import { Connection } from 'mongoose';
import { PUBLIC_ROUTE_KEY } from '../../../common/decorators/public';
import { HealthController } from '.';

describe('HealthController', () => {
  const createController = (readyState: number) => new HealthController({ readyState } as unknown as Connection);

  it('exposes health checks without authentication', () => {
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY, HealthController)).toBe(true);
  });

  it('reports process liveness without depending on MongoDB', () => {
    const response = createController(0).getLiveness();

    expect(response).toMatchObject({
      status: 'alive',
      timestamp: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
  });

  it('reports readiness when MongoDB is connected', () => {
    const response = createController(1).getReadiness();

    expect(response).toMatchObject({
      checks: { mongodb: 'connected' },
      status: 'ready',
    });
  });

  it('returns service unavailable while MongoDB is disconnected', () => {
    const controller = createController(0);

    try {
      controller.getReadiness();
      throw new Error('Expected readiness check to fail');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ServiceUnavailableException);
      expect((cause as ServiceUnavailableException).getStatus()).toBe(503);
      expect((cause as ServiceUnavailableException).getResponse()).toMatchObject({
        checks: { mongodb: 'disconnected' },
        status: 'unavailable',
      });
    }
  });
});
