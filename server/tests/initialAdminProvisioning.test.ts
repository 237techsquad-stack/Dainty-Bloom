import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../src/app';
import { ACCESS_COOKIE } from '../src/middleware/authenticate';
import {
  AuditEvent,
  InitialAdminProvisioning,
  StaffControl,
  User,
} from '../src/models';
import {
  configuredDatabaseName,
  provisionInitialAdmin,
  verifyProductionDatabase,
} from '../src/services/initialAdminProvisioning.service';

let replicaSet: MongoMemoryReplSet;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AuditEvent.init(),
    InitialAdminProvisioning.init(),
    StaffControl.init(),
    User.init(),
  ]);
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

describe('initial administrator provisioning', () => {
  it('creates one active admin with a verified password hash and safe audit event', async () => {
    const password = 'a-strong-test-password';
    await provisionInitialAdmin({
      name: 'Initial Operator',
      email: '  ADMIN@example.test ',
      password,
    });

    const user = await User.findOne({ email: 'admin@example.test' }).select(
      '+passwordHash',
    );
    expect(user).not.toBeNull();
    expect(user).toMatchObject({
      role: 'admin',
      accountState: 'active',
      emailVerified: false,
    });
    expect(user?.passwordHash).not.toBe(password);
    await expect(bcrypt.compare(password, user!.passwordHash)).resolves.toBe(
      true,
    );
    await expect(User.countDocuments({ role: 'admin' })).resolves.toBe(1);

    const auditEvent = await AuditEvent.findOne({
      action: 'admin.initial_provisioned',
    }).lean();
    expect(auditEvent).toMatchObject({
      actorRole: 'admin',
      targetType: 'User',
      targetId: user?._id.toString(),
      metadata: { method: 'operator_command' },
    });
    expect(JSON.stringify(auditEvent)).not.toContain(password);
    expect(JSON.stringify(auditEvent)).not.toContain(user?.passwordHash);
    await expect(
      StaffControl.findById('active_admin_count').lean(),
    ).resolves.toMatchObject({ activeAdminCount: 1 });
  });

  it('rejects invalid emails and passwords that violate the existing policy', async () => {
    await expect(
      provisionInitialAdmin({
        name: 'Operator',
        email: 'not-an-email',
        password: 'a-strong-test-password',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADMIN_DETAILS' });
    await expect(
      provisionInitialAdmin({
        name: 'Operator',
        email: 'operator@example.test',
        password: 'short',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADMIN_DETAILS' });
    await expect(User.countDocuments()).resolves.toBe(0);
  });

  it('refuses to create an admin when an active admin already exists', async () => {
    await User.create({
      name: 'Existing Admin',
      email: 'existing@example.test',
      passwordHash: await bcrypt.hash('existing-admin-test-password', 10),
      role: 'admin',
      accountState: 'active',
    });

    await expect(
      provisionInitialAdmin({
        name: 'Another Operator',
        email: 'another@example.test',
        password: 'another-strong-test-password',
      }),
    ).rejects.toMatchObject({ code: 'ACTIVE_ADMIN_EXISTS' });
    await expect(User.countDocuments({ role: 'admin' })).resolves.toBe(1);
    await expect(InitialAdminProvisioning.countDocuments()).resolves.toBe(0);
  });

  it('rejects concurrent and repeated execution without creating a second administrator', async () => {
    const attempts = await Promise.allSettled([
      provisionInitialAdmin({
        name: 'Initial Operator',
        email: 'initial@example.test',
        password: 'a-strong-test-password',
      }),
      provisionInitialAdmin({
        name: 'Another Operator',
        email: 'another@example.test',
        password: 'another-strong-test-password',
      }),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      provisionInitialAdmin({
        name: 'Repeated Operator',
        email: 'repeated@example.test',
        password: 'repeated-strong-test-password',
      }),
    ).rejects.toMatchObject({ code: 'INITIAL_ADMIN_ALREADY_PROVISIONED' });
    await expect(User.countDocuments({ role: 'admin' })).resolves.toBe(1);
    await expect(
      AuditEvent.countDocuments({ action: 'admin.initial_provisioned' }),
    ).resolves.toBe(1);
  });

  it('requires explicit production database identification and confirmation', () => {
    const uri = 'mongodb+srv://operator:secret@example.test/dainty_bloom';
    expect(configuredDatabaseName(uri)).toBe('dainty_bloom');
    expect(() =>
      configuredDatabaseName(
        'mongodb+srv://operator:secret@example.test/dainty_bloom?dbName=other',
      ),
    ).toThrow(
      expect.objectContaining({ code: 'INVALID_DATABASE_CONFIGURATION' }),
    );
    expect(() =>
      verifyProductionDatabase('production', uri, 'wrong-database'),
    ).toThrow(
      expect.objectContaining({ code: 'DATABASE_CONFIRMATION_FAILED' }),
    );
    expect(() =>
      verifyProductionDatabase(
        'production',
        'mongodb+srv://operator:secret@example.test',
        'dainty_bloom',
      ),
    ).toThrow(expect.objectContaining({ code: 'DATABASE_NAME_REQUIRED' }));
    expect(() =>
      verifyProductionDatabase(
        'production',
        'mongodb://127.0.0.1:27017/dainty_bloom',
        'dainty_bloom',
      ),
    ).toThrow(
      expect.objectContaining({ code: 'LOCAL_PRODUCTION_DATABASE_FORBIDDEN' }),
    );
    expect(() =>
      verifyProductionDatabase('production', uri, 'dainty_bloom'),
    ).not.toThrow();
    expect(() =>
      verifyProductionDatabase('development', 'mongodb://127.0.0.1:27017', ''),
    ).not.toThrow();
  });

  it('does not expose an administrator-provisioning HTTP endpoint', async () => {
    const user = await User.create({
      name: 'Existing Admin',
      email: 'existing@example.test',
      passwordHash: await bcrypt.hash('existing-admin-test-password', 10),
      role: 'admin',
      accountState: 'active',
    });
    const accessToken = jwt.sign(
      { sub: user._id.toString(), ver: user.tokenVersion, typ: 'access' },
      process.env.JWT_ACCESS_SECRET ?? '',
      { expiresIn: '15m' },
    );
    const response = await request(app)
      .post('/api/admin/initial-admin')
      .set('X-Requested-With', 'dainty-bloom');
    const publicResponse = await request(app)
      .post('/api/initial-admin')
      .set('X-Requested-With', 'dainty-bloom');
    const authenticatedResponse = await request(app)
      .post('/api/admin/initial-admin')
      .set('X-Requested-With', 'dainty-bloom')
      .set('Cookie', `${ACCESS_COOKIE}=${accessToken}`);

    expect(response.status).toBe(401);
    expect(publicResponse.status).toBe(404);
    expect(publicResponse.body.error.code).toBe('NOT_FOUND');
    expect(authenticatedResponse.status).toBe(404);
    expect(authenticatedResponse.body.error.code).toBe('NOT_FOUND');
  });

  it('rolls back all writes when MongoDB cannot run the required transaction', async () => {
    await mongoose.disconnect();
    const standalone = await MongoMemoryServer.create();
    try {
      await mongoose.connect(standalone.getUri());
      await expect(
        provisionInitialAdmin({
          name: 'Operator',
          email: 'operator@example.test',
          password: 'a-strong-test-password',
        }),
      ).rejects.toThrow();
      await expect(User.countDocuments()).resolves.toBe(0);
      await expect(AuditEvent.countDocuments()).resolves.toBe(0);
      await expect(InitialAdminProvisioning.countDocuments()).resolves.toBe(0);
      expect(mongoose.connection.readyState).toBe(1);
    } finally {
      await mongoose.disconnect();
      await standalone.stop();
      await mongoose.connect(replicaSet.getUri());
    }

    await expect(User.countDocuments()).resolves.toBe(0);
    await expect(AuditEvent.countDocuments()).resolves.toBe(0);
    await expect(InitialAdminProvisioning.countDocuments()).resolves.toBe(0);
  });
});
