import type { Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';
import { registerSchema, requestCodeSchema, verifyCodeSchema } from '@kidzonia/shared';
import type { z } from 'zod';
import { withUnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AppError, notLoggedIn } from '../../lib/errors.js';
import { REFRESH_COOKIE } from '../auth/routes.js';
import { hashPassword } from '../auth/passwords.js';
import { AuthService } from '../auth/service.js';
import type { ClientInfo } from '../auth/service.js';
import { createSeedRoles } from '../seed-roles.js';
import { setAssignment } from '../roles/rules.js';

type Registration = z.output<typeof registerSchema>;

const client = (req: Request): ClientInfo => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
});

/**
 * Registration (brief 8.1). The mobile is proved with a one-time code first;
 * that gives a single-use registration token. Creating the organisation,
 * its schools, the seed roles, the registrant as Owner and any invited
 * franchise owners then happens in ONE transaction.
 */
export function registrationRoutes(deps: AppDeps): RouteDef[] {
  const auth = new AuthService(deps);

  async function createOrganisation(input: Registration, mobile: string) {
    const organisationId = uuidv7();
    const ownerId = uuidv7();
    const passwordHash = await hashPassword(input.password);
    const db = deps.data.forNewOrganisation(organisationId);
    const invites: { mobile: string }[] = [];
    const now = deps.now();

    await withUnitOfWork(
      db,
      { organisationId, userId: ownerId, requestId: null },
      async (uow) => {
        await uow.tx.organisation.create({
          data: {
            id: organisationId,
            name: input.organisation.name,
            setupType: input.setupType,
            schoolModel: input.setupType === 'single_school' ? 'coco' : input.schoolModel,
            workingDays: input.organisation.workingDays,
            opensAt: input.organisation.opensAt,
            closesAt: input.organisation.closesAt,
            createdBy: ownerId,
          },
          select: { id: true },
        });
        const roles = await createSeedRoles(uow, organisationId);

        // A single school is still an organisation with one school (brief 5.1).
        const schools =
          input.setupType === 'single_school'
            ? [
                {
                  name: input.organisation.name,
                  city: input.organisation.city,
                  type: 'coco' as const,
                  owner: null,
                },
              ]
            : input.schools;
        const schoolIds: string[] = [];
        for (const s of schools) {
          const school = await uow.tx.school.create({
            data: {
              organisationId,
              name: s.name,
              city: s.city,
              state: input.organisation.state,
              type: s.type,
              createdBy: ownerId,
            },
            select: { id: true, franchiseOwnerUserId: true },
          });
          schoolIds.push(school.id);
        }

        await uow.tx.user.create({
          data: {
            id: ownerId,
            organisationId,
            fullName: input.fullName,
            mobile,
            email: input.email ?? null,
            jobTitle: 'Owner',
            homeSchoolId: input.setupType === 'single_school' ? (schoolIds[0] ?? null) : null,
            status: 'active',
            passwordHash,
          },
          select: { id: true, homeSchoolId: true },
        });
        const ownerRole = roles.owner;
        if (!ownerRole) throw new Error('Owner role missing from seed roles');
        await setAssignment(uow.tx, organisationId, ownerId, {
          roleId: ownerRole,
          scope: { allSchools: true, schoolIds: [] },
        });

        // Franchise owners named at sign-up are invited as their school's Franchise owner.
        const franchiseRole = roles.franchise_owner;
        for (const [i, s] of schools.entries()) {
          const schoolId = schoolIds[i];
          if (!s.owner || !schoolId || !franchiseRole) continue;
          if (s.owner.mobile === mobile || invites.some((x) => x.mobile === s.owner?.mobile)) {
            throw new AppError(
              'invalid_input',
              'Each franchise owner needs their own mobile number.',
              {
                [`schools.${i}.owner.mobile`]: 'Use a different mobile number.',
              },
            );
          }
          const id = uuidv7();
          await uow.tx.user.create({
            data: {
              id,
              organisationId,
              fullName: s.owner.fullName,
              mobile: s.owner.mobile,
              jobTitle: 'Franchise owner',
              homeSchoolId: schoolId,
              status: 'invited',
              invitedAt: now,
            },
            select: { id: true, homeSchoolId: true },
          });
          await setAssignment(uow.tx, organisationId, id, {
            roleId: franchiseRole,
            scope: { allSchools: false, schoolIds: [schoolId] },
          });
          await uow.tx.school.update({
            where: { id: schoolId },
            data: { franchiseOwnerUserId: id },
            select: { id: true, franchiseOwnerUserId: true },
          });
          invites.push({ mobile: s.owner.mobile });
        }
        uow.audit({
          action: 'organisation.registered',
          entityType: 'organisation',
          entityId: organisationId,
          after: {
            name: input.organisation.name,
            setupType: input.setupType,
            schools: schools.length,
          },
        });
      },
      { timeoutMs: 60_000 },
    );

    for (const inv of invites) {
      await deps.messages.sendInvite(inv.mobile, {
        organisationName: input.organisation.name,
        inviterName: input.fullName,
        appUrl: deps.config.APP_URL,
      });
    }
    return { organisationId, ownerId };
  }

  const sendSignedIn = (
    res: Response,
    signed: Awaited<ReturnType<AuthService['startSessionFor']>>,
  ) => {
    if (signed.refreshToken && signed.refreshExpiresAt) {
      res.cookie(REFRESH_COOKIE, signed.refreshToken, {
        httpOnly: true,
        secure: deps.config.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        expires: signed.refreshExpiresAt,
      });
    }
    res.status(201).json(signed.result);
  };

  return [
    {
      method: 'post',
      path: '/register/request-code',
      access: 'public',
      handler: async (req, res) => {
        const { mobile } = parse(requestCodeSchema, req.body);
        res.status(201).json(await auth.requestCode(mobile, client(req), true));
      },
    },
    {
      method: 'post',
      path: '/register/verify-code',
      access: 'public',
      handler: async (req, res) => {
        const input = parse(verifyCodeSchema, req.body);
        const mobile = await auth.proveCode(input.challengeId, input.code);
        const now = deps.now();
        const ttl = deps.config.REGISTRATION_TOKEN_TTL_MINUTES * 60;
        const jti = uuidv7();
        await deps.data.auth.issueOneTimeToken(
          jti,
          'register',
          new Date(now.getTime() + ttl * 1000),
        );
        res.json({
          registrationToken: await deps.tokens.issueRegistration({ mobile, jti }, ttl, now),
        });
      },
    },
    {
      method: 'post',
      path: '/register',
      access: 'public',
      handler: async (req, res) => {
        const input = parse(registerSchema, req.body);
        const now = deps.now();
        const claims = await deps.tokens.verifyRegistration(input.registrationToken, now);
        if (!claims)
          throw notLoggedIn('Your mobile check has expired. Please verify your number again.');
        await deps.rateLimits.consumeRegistration(client(req).ip);
        if (!(await deps.data.auth.consumeOneTimeToken(claims.jti, 'register', now))) {
          throw notLoggedIn('This sign-up has already been used. Please verify your number again.');
        }
        const { organisationId, ownerId } = await createOrganisation(input, claims.mobile);
        const signed = await auth.startSessionFor(
          {
            userId: ownerId,
            organisationId,
            organisationName: input.organisation.name,
            logoKey: null,
            passwordHash: null,
          },
          client(req),
        );
        sendSignedIn(res, signed);
      },
    },
  ];
}
