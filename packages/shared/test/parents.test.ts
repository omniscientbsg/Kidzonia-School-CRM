import { describe, expect, it } from 'vitest';
import { maskMobile, parseContactsCsv, parseCsv, renderParentMessage } from '../src/index.js';

describe('CSV reading', () => {
  it('handles quotes, commas and line breaks inside quotes, CRLF and a byte-order mark', () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n"multi\nline",2,3\n\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['multi\nline', '2', '3'],
    ]);
  });
});

describe('parent contacts CSV (Phase 6 answer 1)', () => {
  const header = 'Class,Student name,Parent name,Parent mobile,Agreed to messages';

  it('reads good rows and normalises numbers and answers', () => {
    const csv = parseContactsCsv(
      `${header}\nNursery A,Aarav Kumar,Neha Kumar,98480 55501,yes\nKG 1,Diya,Kiran,+91 98480-55502,No\n`,
      100,
    );
    expect(csv.problems).toEqual([]);
    expect(csv.rows).toEqual([
      expect.objectContaining({
        line: 2,
        className: 'Nursery A',
        mobile: '+919848055501',
        agreed: true,
        errors: [],
      }),
      expect.objectContaining({ line: 3, mobile: '+919848055502', agreed: false, errors: [] }),
    ]);
  });

  it('accepts the columns in any order and with other common names', () => {
    const csv = parseContactsCsv(
      'Mobile,Consent,Child,Parent,Class\n9848055501,y,Aarav,Neha,KG 2\n',
      10,
    );
    expect(csv.rows[0]).toMatchObject({
      className: 'KG 2',
      studentName: 'Aarav',
      mobile: '+919848055501',
      agreed: true,
    });
  });

  it('flags each bad row with its reasons', () => {
    const csv = parseContactsCsv(
      [
        header,
        'Nursery A,Aarav,Neha,12345,yes',
        'Nursery A,,Neha,9848055501,maybe',
        'Nursery A,Diya,Kiran,9848055502,yes',
        'Nursery A,Diya,Kiran,9848055502,yes',
        'KG 1,Isha,Someone Else,9848055502,yes',
      ].join('\n'),
      10,
    );
    const errors = csv.rows.map((r) => r.errors);
    expect(errors[0]).toEqual(['The parent mobile isn’t a valid number.']);
    expect(errors[1]).toEqual([
      'Student name is missing.',
      '“Agreed to messages” must be yes or no.',
    ]);
    expect(errors[2]).toEqual([]);
    expect(errors[3]).toEqual(['Same child and parent as row 4.']);
    expect(errors[4]).toEqual(['This number is given to Kiran on row 4.']);
  });

  it('refuses a file without the columns, or with too many rows', () => {
    expect(parseContactsCsv('Name,Phone\nA,1\n', 10).problems[0]).toMatch(/must name the columns/);
    const many = `${header}\n${Array.from({ length: 3 }, () => 'A,B,C,9848055501,yes').join('\n')}`;
    expect(parseContactsCsv(many, 2).problems[0]).toMatch(/at most 2/);
  });
});

describe('parents’ numbers outside the contacts screen', () => {
  it('show only the last three digits', () => {
    expect(maskMobile('+919848055501')).toBe('+91 ••••• ••501');
    expect(maskMobile('+447700900123')).toBe('••••• ••123');
    expect(maskMobile('12')).toBe('•••');
  });
});

describe('parent message text (brief 9.12)', () => {
  it('fills the fill-in words and leaves unknown braces alone', () => {
    expect(
      renderParentMessage(
        'Dear parent, {class_name} did {activity} for {event_name}. {student_name} at {school_name}. {other}',
        {
          student_name: 'Aarav',
          class_name: 'Nursery A',
          event_name: 'Annual Day',
          activity: 'rehearsal',
          school_name: 'Jubilee Hills',
        },
      ),
    ).toBe('Dear parent, Nursery A did rehearsal for Annual Day. Aarav at Jubilee Hills. {other}');
  });
});
