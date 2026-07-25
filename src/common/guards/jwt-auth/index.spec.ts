import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '../../../modules/admin/schemas';
import { SessionAuthorizationService } from '../../../modules/auth/session-authorization';
import { JwtAuthGuard } from '.';

describe('JwtAuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const authorize = jest.fn();
  const sessionAuthorization = { authorize } as unknown as SessionAuthorizationService;
  const guard = new JwtAuthGuard(reflector, sessionAuthorization);

  const createContext = (authorization?: string) => {
    const request: {
      headers: { authorization?: string };
      user?: { email: string; hostId: string; role: AdminRole };
    } = { headers: { authorization } };
    const context = {
      getClass: () => class TestController {},
      getHandler: () => function testHandler() {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
    authorize.mockResolvedValue({
      email: 'host@example.com',
      hostId: 'host-1',
      role: AdminRole.HOST,
    });
  });

  it('allows explicitly public routes without a token', async () => {
    getAllAndOverride.mockReturnValue(true);
    const { context } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('rejects protected routes without a bearer token', async () => {
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authorizes a protected route and attaches the current user', async () => {
    const { context, request } = createContext('Bearer secure-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith('secure-token');
    expect(request.user).toEqual({
      email: 'host@example.com',
      hostId: 'host-1',
      role: AdminRole.HOST,
    });
  });
});
