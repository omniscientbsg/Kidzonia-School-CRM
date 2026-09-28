import type { ScopedDb } from '../db/index.js';

/**
 * Demo classes and parent contacts (Phase 6). Every demo school gets the
 * demo's five classes; Nursery A at Jubilee Hills and KG 2 at Kondapur get a
 * few children and parents, some agreed, one not, one opted out, so the parent
 * message journeys can be tried. Numbers are made up (the 99999 range).
 */

const CLASSES = ['Playgroup', 'Nursery A', 'Nursery B', 'KG 1', 'KG 2'];

type Consent = 'agreed' | 'not_agreed' | 'opted_out';
interface Contact {
  school: string;
  className: string;
  student: string;
  parent: string;
  mobile: string;
  consent: Consent;
}

const CONTACTS: Contact[] = [
  {
    school: 'jh',
    className: 'Nursery A',
    student: 'Aarav Kumar',
    parent: 'Neha Kumar',
    mobile: '+919999900001',
    consent: 'agreed',
  },
  {
    school: 'jh',
    className: 'Nursery A',
    student: 'Diya Reddy',
    parent: 'Kiran Reddy',
    mobile: '+919999900002',
    consent: 'agreed',
  },
  {
    school: 'jh',
    className: 'Nursery A',
    student: 'Ishaan Rao',
    parent: 'Swathi Rao',
    mobile: '+919999900003',
    consent: 'agreed',
  },
  {
    school: 'jh',
    className: 'Nursery A',
    student: 'Meher Ali',
    parent: 'Farhan Ali',
    mobile: '+919999900004',
    consent: 'not_agreed',
  },
  {
    school: 'jh',
    className: 'Nursery A',
    student: 'Saanvi Joshi',
    parent: 'Rekha Joshi',
    mobile: '+919999900005',
    consent: 'opted_out',
  },
  // One parent, two children (Nursery A and KG 1).
  {
    school: 'jh',
    className: 'KG 1',
    student: 'Vihaan Kumar',
    parent: 'Neha Kumar',
    mobile: '+919999900001',
    consent: 'agreed',
  },
  {
    school: 'kp',
    className: 'KG 2',
    student: 'Anaya Varma',
    parent: 'Lakshmi Varma',
    mobile: '+919999900011',
    consent: 'agreed',
  },
  {
    school: 'kp',
    className: 'KG 2',
    student: 'Reyansh Gupta',
    parent: 'Amit Gupta',
    mobile: '+919999900012',
    consent: 'agreed',
  },
  {
    school: 'kp',
    className: 'KG 2',
    student: 'Zara Khan',
    parent: 'Sana Khan',
    mobile: '+919999900013',
    consent: 'not_agreed',
  },
];

export async function seedParents(
  db: ScopedDb,
  organisationId: string,
  schools: Readonly<Record<string, string>>,
  now: Date,
): Promise<void> {
  const classIds = new Map<string, string>();
  for (const [key, schoolId] of Object.entries(schools)) {
    for (const [i, name] of CLASSES.entries()) {
      const c = await db.schoolClass.create({
        data: { organisationId, schoolId, name, sortOrder: i },
        select: { id: true },
      });
      classIds.set(`${key}|${name}`, c.id);
    }
  }
  const guardians = new Map<string, string>();
  const students = new Map<string, string>();
  for (const c of CONTACTS) {
    const schoolId = schools[c.school];
    const classId = classIds.get(`${c.school}|${c.className}`);
    if (!schoolId || !classId) continue;
    let guardianId = guardians.get(c.mobile);
    if (!guardianId) {
      const g = await db.guardian.create({
        data: {
          organisationId,
          fullName: c.parent,
          mobile: c.mobile,
          consent: c.consent,
          consentChangedAt: c.consent === 'not_agreed' ? null : now,
        },
        select: { id: true },
      });
      guardianId = g.id;
      guardians.set(c.mobile, guardianId);
    }
    const sKey = `${classId}|${c.student}`;
    let studentId = students.get(sKey);
    if (!studentId) {
      const s = await db.student.create({
        data: { organisationId, schoolId, classId, fullName: c.student },
        select: { id: true },
      });
      studentId = s.id;
      students.set(sKey, studentId);
    }
    await db.studentGuardian.create({ data: { organisationId, studentId, guardianId } });
  }
}

/** Whether the demo's classes are in (the flag for grafting onto a development database). */
export async function hasParentSeed(db: ScopedDb): Promise<boolean> {
  return (await db.schoolClass.count()) > 0;
}
