'use strict';

const NATIONAL_USERS = [
  { name: 'Nimal Perera', email: 'nimal.perera@slsea.gov.lk', role: 'administrator' },
  { name: 'Ayesha Fernando', email: 'ayesha.fernando@slsea.gov.lk', role: 'analyst' },
];

const PROVINCE_USERS = [
  { provinceCode: 'WP', name: 'Kanchana Silva', email: 'kanchana.silva@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'CP', name: 'Ruwan Jayasinghe', email: 'ruwan.jayasinghe@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'SP', name: 'Sanduni Wickramasinghe', email: 'sanduni.wickramasinghe@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'NP', name: 'Tharindu Bandara', email: 'tharindu.bandara@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'EP', name: 'Madhusree Rajapaksa', email: 'madhusree.rajapaksa@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'NW', name: 'Dinesh Kumara', email: 'dinesh.kumara@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'NC', name: 'Shanika Dissanayake', email: 'shanika.dissanayake@slsea.gov.lk', role: 'engineer' },
  { provinceCode: 'UP', name: 'Prasanna Ekanayake', email: 'prasanna.ekanayake@slsea.gov.lk', role: 'analyst' },
  { provinceCode: 'SG', name: 'Hasini Gunasekara', email: 'hasini.gunasekara@slsea.gov.lk', role: 'analyst' },
];

const DISTRICT_USERS = [
  { districtCode: 'COL', name: 'Chamara Alwis', email: 'chamara.alwis@slsea.gov.lk', role: 'analyst' },
  { districtCode: 'GAM', name: 'Lakmal Weerasinghe', email: 'lakmal.weerasinghe@slsea.gov.lk', role: 'analyst' },
  { districtCode: 'KAN', name: 'Sunil Rathnayake', email: 'sunil.rathnayake@slsea.gov.lk', role: 'engineer' },
  { districtCode: 'GAL', name: 'Nadeesha Herath', email: 'nadeesha.herath@slsea.gov.lk', role: 'analyst' },
  { districtCode: 'JAF', name: 'Thivakaran Senthil', email: 'thivakaran.senthil@slsea.gov.lk', role: 'analyst' },
  { districtCode: 'TRI', name: 'Fathima Rizvi', email: 'fathima.rizvi@slsea.gov.lk', role: 'analyst' },
  { districtCode: 'ANU', name: 'Dilantha Kumara', email: 'dilantha.kumara@slsea.gov.lk', role: 'engineer' },
  { districtCode: 'RAT', name: 'Ishara Madushani', email: 'ishara.madushani@slsea.gov.lk', role: 'analyst' },
];

const EMPLOYEE_ID_PREFIX = 'SLSEA-';

function seedUsers(db) {
  const provinceIds = new Map(
    db.prepare(`SELECT id, code FROM provinces`).all().map((row) => [row.code, row.id])
  );
  const districtIds = new Map(
    db.prepare(`SELECT id, code FROM districts`).all().map((row) => [row.code, row.id])
  );

  const insert = db.prepare(
    `INSERT INTO users
       (employee_id, name, email, role, jurisdiction_type, jurisdiction_id, province_id, district_id)
     VALUES
       (@employee_id, @name, @email, @role, @jurisdiction_type, @jurisdiction_id, @province_id, @district_id)`
  );

  return db.transaction(() => {
    const created = [];
    let sequence = 1;

    const insertUser = (user, jurisdictionType, jurisdictionId, provinceId, districtId) => {
      const result = insert.run({
        employee_id: `${EMPLOYEE_ID_PREFIX}${String(sequence).padStart(4, '0')}`,
        name: user.name,
        email: user.email,
        role: user.role,
        jurisdiction_type: jurisdictionType,
        jurisdiction_id: jurisdictionId,
        province_id: provinceId,
        district_id: districtId,
      });
      sequence += 1;
      created.push({
        id: Number(result.lastInsertRowid),
        employeeId: `${EMPLOYEE_ID_PREFIX}${String(sequence - 1).padStart(4, '0')}`,
        name: user.name,
        role: user.role,
        jurisdictionType,
        jurisdictionId,
      });
    };

    for (const user of NATIONAL_USERS) {
      insertUser(user, 'national', null, null, null);
    }

    for (const user of PROVINCE_USERS) {
      const provinceId = provinceIds.get(user.provinceCode);
      if (provinceId === undefined) {
        throw new Error(`Province user ${user.email} references unknown province ${user.provinceCode}`);
      }
      insertUser(user, 'province', provinceId, provinceId, null);
    }

    for (const user of DISTRICT_USERS) {
      const districtId = districtIds.get(user.districtCode);
      if (districtId === undefined) {
        throw new Error(`District user ${user.email} references unknown district ${user.districtCode}`);
      }
      insertUser(user, 'district', districtId, null, districtId);
    }

    const byType = created.reduce((accumulator, user) => {
      accumulator[user.jurisdictionType] = (accumulator[user.jurisdictionType] || 0) + 1;
      return accumulator;
    }, {});

    return { users: created, counts: { users: created.length, ...byType } };
  })();
}

module.exports = { seedUsers, NATIONAL_USERS, PROVINCE_USERS, DISTRICT_USERS };
