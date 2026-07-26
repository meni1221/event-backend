import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request = require('supertest');
import { JwtAuthGuard } from '../common/guards/jwt-auth';
import { Admin, AdminAccountStatus, AdminDocument, AdminRole, AdminSchema } from '../modules/admin/schemas';
import { SessionAuthorizationService } from '../modules/auth/session-authorization';
import { EventsController } from '../modules/events/controller';
import { Event, EventDocument, EventSchema } from '../modules/events/schemas';
import { EventsService } from '../modules/events/service';
import { Guest, GuestSchema } from '../modules/guests/schemas';

jest.mock('nanoid', () => ({ nanoid: () => 'integration-invite-id' }));

const jwtSecret = 'integration-test-secret-with-at-least-32-characters';

describe('Events HTTP tenant isolation', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let adminModel: Model<AdminDocument>;
  let eventModel: Model<EventDocument>;
  let jwt: JwtService;
  let hostAToken: string;
  let hostAId: string;
  let hostBEventId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: jwtSecret }),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: Admin.name, schema: AdminSchema },
          { name: Event.name, schema: EventSchema },
          { name: Guest.name, schema: GuestSchema },
        ]),
      ],
      controllers: [EventsController],
      providers: [
        EventsService,
        SessionAuthorizationService,
        JwtAuthGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    adminModel = moduleFixture.get<Model<AdminDocument>>(getModelToken(Admin.name));
    eventModel = moduleFixture.get<Model<EventDocument>>(getModelToken(Event.name));
    jwt = moduleFixture.get(JwtService);
  });

  beforeEach(async () => {
    await Promise.all([adminModel.deleteMany({}), eventModel.deleteMany({})]);
    const [hostA, hostB] = await adminModel.create([
      {
        accountStatus: AdminAccountStatus.APPROVED,
        email: 'host-a@example.com',
        passwordHash: 'not-used-in-integration-tests',
        role: AdminRole.HOST,
      },
      {
        accountStatus: AdminAccountStatus.APPROVED,
        email: 'host-b@example.com',
        passwordHash: 'not-used-in-integration-tests',
        role: AdminRole.HOST,
      },
    ]);
    hostAId = hostA.id;
    hostAToken = jwt.sign({ sub: hostA.id, sessionVersion: 0 });
    const hostBEvent = await eventModel.create({ eventName: 'Host B private event', hostId: hostB._id });
    hostBEventId = hostBEvent.id;
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('rejects protected event requests without a bearer token', async () => {
    await request(app.getHttpServer()).get('/api/events').expect(401);
  });

  it('returns only events owned by the authenticated host', async () => {
    await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${hostAToken}`)
      .send({ eventName: 'Host A event' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/events')
      .set('Authorization', `Bearer ${hostAToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].eventName).toBe('Host A event');
  });

  it('does not reveal or update another host event', async () => {
    await request(app.getHttpServer())
      .patch(`/api/events/${hostBEventId}`)
      .set('Authorization', `Bearer ${hostAToken}`)
      .send({ eventName: 'Stolen event' })
      .expect(404);

    const untouchedEvent = await eventModel.findById(hostBEventId).lean().exec();
    expect(untouchedEvent?.eventName).toBe('Host B private event');
  });

  it('binds newly created events to the authenticated host', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${hostAToken}`)
      .send({ eventName: 'New owned event' })
      .expect(201);

    const createdEvent = await eventModel.findById(response.body._id).lean().exec();
    expect(createdEvent?.hostId.toString()).toBe(hostAId);
  });

  it('enforces DTO allowlists at the HTTP boundary', async () => {
    await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${hostAToken}`)
      .send({ eventName: 'Invalid event', hostId: hostAId })
      .expect(400);
  });
});
