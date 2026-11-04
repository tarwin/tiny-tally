// Pick lists for places. A country's name comes from the browser's own data.
import { CA_PROVINCES } from '../shared/canada';
import { IN_STATES } from '../shared/india';

export const IN_STATE_OPTIONS = IN_STATES.map((s) => ({ label: `${s.name} (${s.code})`, value: s.code }));

export const CA_PROVINCE_OPTIONS = CA_PROVINCES.map((p) => ({ label: p.name, value: p.code }));

const CODES = 'AE AR AT AU BD BE BR CA CH CL CN CO CZ DE DK EG ES FI FR GB GR HK HU ID IE IL IN IT JP KE KR LK MX MY NG NL NO NP NZ PH PK PL PT QA RO SA SE SG TH TR TW UA US VN ZA'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });

export const WORLD_COUNTRIES = CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
