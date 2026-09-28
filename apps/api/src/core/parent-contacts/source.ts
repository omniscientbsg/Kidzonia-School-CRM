import type { ScopedTx } from '../../db/index.js';

/**
 * Where parents' contacts come from (brief 9.12, open decision 13.1). Today
 * that's Core's small contact list, filled from CSVs; a future Students module
 * can provide its own source behind this interface without the sender
 * changing. Only parents who have agreed to messages are ever returned.
 */
export interface ParentRecipient {
  guardianId: string;
  studentId: string;
  studentName: string;
  parentName: string;
}

export interface ParentContactSource {
  /** Parents who agreed to messages, for one class at one school, one entry per child. */
  recipients(db: ScopedTx, schoolId: string, className: string): Promise<ParentRecipient[]>;
  /**
   * The parent's number, read at the moment of sending, and only while they
   * still agree: someone who opted out after the message was queued is never
   * texted. Null means don't send.
   */
  sendableMobile(db: ScopedTx, guardianId: string): Promise<string | null>;
}

export class CoreParentContacts implements ParentContactSource {
  async recipients(db: ScopedTx, schoolId: string, className: string): Promise<ParentRecipient[]> {
    const links = await db.studentGuardian.findMany({
      where: {
        guardian: { consent: 'agreed' },
        student: {
          schoolId,
          class: { name: { equals: className.trim(), mode: 'insensitive' } },
        },
      },
      select: {
        studentId: true,
        guardianId: true,
        student: { select: { fullName: true } },
        guardian: { select: { fullName: true } },
      },
      orderBy: [{ studentId: 'asc' }, { guardianId: 'asc' }],
    });
    return links.map((l) => ({
      guardianId: l.guardianId,
      studentId: l.studentId,
      studentName: l.student.fullName,
      parentName: l.guardian.fullName,
    }));
  }

  async sendableMobile(db: ScopedTx, guardianId: string): Promise<string | null> {
    const g = await db.guardian.findFirst({
      where: { id: guardianId, consent: 'agreed' },
      select: { mobile: true },
    });
    return g?.mobile ?? null;
  }
}
