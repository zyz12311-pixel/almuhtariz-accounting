import {getSetting} from './core.js';

const activities = new Set(['trade','events','engineering']);

export function validateActivity(value) {
  if (!activities.has(value)) throw Error('النشاط غير صالح');
  return value;
}

export function companyActivity(db) {
  const value = getSetting(db,'company').activity;
  return activities.has(value) ? value : 'trade';
}

export function posPoint(db, user, value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Error('اختر نقطة بيع');
  const hasActivity = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('pos_points') WHERE name='activity'").get().n > 0;
  const point = db.prepare('SELECT * FROM pos_points WHERE id=? AND active=1').get(id);
  if (!point) throw Error('نقطة البيع غير مفعلة');
  if (user.role === 'staff' && !db.prepare('SELECT 1 FROM pos_user_access WHERE user_id=? AND pos_id=?').get(user.id,id)) {
    throw Object.assign(Error('نقطة البيع غير مسموحة لهذا العامل'),{status:403});
  }
  return point;
}

export function catalogPoint(db, user, value) {
  if (value !== undefined) return posPoint(db,user,value);
  const assigned = user.role === 'staff';
  const points = db.prepare(
    'SELECT p.* FROM pos_points p WHERE p.active=1 '+
    (assigned ? 'AND EXISTS(SELECT 1 FROM pos_user_access a WHERE a.pos_id=p.id AND a.user_id=?) ' : '')+
    'ORDER BY p.id LIMIT 2'
  ).all(...(assigned ? [user.id] : []));
  if (!points.length) throw Object.assign(Error('لا توجد نقطة بيع مفعلة متاحة لهذا الحساب'),{status:403});
  if (points.length > 1) throw Error('اختر نقطة البيع لعرض كتالوجها');
  return points[0];
}
