type RateLimit = {
  default: {
    blockDuration?: number;
    limit: number;
    ttl: number;
  };
};

const minutes = (value: number) => value * 60_000;

export const routeRateLimits = {
  auth: {
    forgotPassword: { default: { blockDuration: minutes(15), limit: 3, ttl: minutes(15) } },
    googleStart: { default: { limit: 20, ttl: minutes(1) } },
    login: { default: { blockDuration: minutes(5), limit: 5, ttl: minutes(1) } },
    register: { default: { blockDuration: minutes(10), limit: 5, ttl: minutes(10) } },
    resetPassword: { default: { blockDuration: minutes(15), limit: 5, ttl: minutes(15) } },
  },
  invitations: {
    read: { default: { limit: 60, ttl: minutes(1) } },
    rsvp: { default: { blockDuration: minutes(1), limit: 20, ttl: minutes(1) } },
  },
  mail: {
    sendBatch: { default: { blockDuration: minutes(10), limit: 3, ttl: minutes(10) } },
  },
  whatsapp: {
    connect: { default: { blockDuration: minutes(1), limit: 10, ttl: minutes(5) } },
    sendBatch: { default: { blockDuration: minutes(1), limit: 6, ttl: minutes(1) } },
    sendTest: { default: { blockDuration: minutes(1), limit: 10, ttl: minutes(1) } },
  },
} as const satisfies Record<string, Record<string, RateLimit>>;

export const getPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
