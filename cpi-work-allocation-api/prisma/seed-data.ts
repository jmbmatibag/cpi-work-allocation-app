/**
 * prisma/seed-data.ts — config/taxonomy constants for the seeders.
 *
 * Single source of truth for everything that's NOT user data, consumed by:
 *   - prisma/seed.ts          (full dev seed — users + config)
 *   - scripts/seed-config.ts  (production deploy — config only)
 *
 * If you change a constant here, both seeders pick it up automatically.
 * Mirrors ClientsConfigContext SEED_* constants on the frontend.
 */

export const TEAMS = [
  'IT/Platforms', 'HR', 'Finance', 'Geniisys', 'Ancillary Solutions',
  'BD/Mktg/Sales', 'Business',
];

// "Internal" is NOT a real client — it's the FALLBACK_CLIENT label baked
// into the frontend dropdown via buildSharedClientList(). Seeding it as
// a Client row creates two SelectItems with value="Internal" (the fallback
// + the real row), which causes the Workspace trigger to render the
// label twice → "InternalInternal".
export const CLIENTS = [
  'AFPGEN', 'AUII', 'CPAIC', 'FGEN', 'MIC', 'NIA',
  'PFIC', 'PNBGEN', 'UCPB', 'CIC', 'FLT', 'Meridian',
];

export const MAIN_CATEGORIES = [
  'General Work', 'Projects', 'HR', 'IT', 'BD/Mktg/Sales', 'Finance',
];

export const SUB_CATEGORIES = [
  { name: 'Geniisys',     parentMainCategory: 'Projects', clients: ['AFPGEN', 'AUII', 'CPAIC'] },
  { name: 'Quick Policy', parentMainCategory: 'Projects', clients: ['AFPGEN', 'AUII', 'PNBGEN', 'CPAIC'] },
];

export const WORK_TYPES = [
  // General Work
  { name: 'Administrative',    parents: ['General Work'] },
  { name: 'Meetings',          parents: ['General Work', 'HR', 'Geniisys', 'Quick Policy', 'IT', 'BD/Mktg/Sales', 'Finance'] },
  { name: 'Training',          parents: ['General Work', 'HR'] },
  { name: 'Documentation',     parents: ['General Work', 'Geniisys', 'Quick Policy', 'IT'] },
  { name: 'Communication',     parents: ['General Work'] },
  { name: 'Research',          parents: ['General Work', 'BD/Mktg/Sales'] },
  // Projects — via sub categories
  { name: 'Implementation',    parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Enhancement',       parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Maintenance',       parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Product Development', parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Support',           parents: ['Geniisys', 'Quick Policy', 'IT'] },
  { name: 'Testing',           parents: ['Geniisys', 'Quick Policy'] },
  // HR
  { name: 'Recruitment',       parents: ['HR'] },
  { name: 'Onboarding',        parents: ['HR'] },
  { name: 'Policy',            parents: ['HR'] },
  { name: 'Compliance',        parents: ['HR', 'Finance'] },
  { name: 'Engagement',        parents: ['HR'] },
  { name: 'Benefits',          parents: ['HR'] },
  // IT
  { name: 'Infrastructure',    parents: ['IT'] },
  { name: 'Security',          parents: ['IT'] },
  { name: 'DevOps',            parents: ['IT'] },
  { name: 'Helpdesk',          parents: ['IT'] },
  { name: 'Networking',        parents: ['IT'] },
  { name: 'Monitoring',        parents: ['IT'] },
  // BD/Mktg/Sales
  { name: 'Lead Generation',   parents: ['BD/Mktg/Sales'] },
  { name: 'Client Relations',  parents: ['BD/Mktg/Sales'] },
  { name: 'Proposals',         parents: ['BD/Mktg/Sales'] },
  { name: 'Marketing Campaign', parents: ['BD/Mktg/Sales'] },
  { name: 'Sales',             parents: ['BD/Mktg/Sales'] },
  // Finance
  { name: 'Budgeting',         parents: ['Finance'] },
  { name: 'Reporting',         parents: ['Finance'] },
  { name: 'Audit',             parents: ['Finance'] },
  { name: 'Forecasting',       parents: ['Finance'] },
];

export const INFERENCE_RULES = [
  { keywords: ['server', 'infrastructure', 'aws', 'cloud', 'migration', 'vm', 'hosting', 'm365', 'microsoft 365', 'o365'], category: 'IT', workType: 'Infrastructure' },
  { keywords: ['security', 'audit', 'firewall', 'vulnerability', 'pentest', 'penetration test'], category: 'IT', workType: 'Security' },
  { keywords: ['devops', 'ci/cd', 'pipeline', 'docker', 'kubernetes'], category: 'IT', workType: 'DevOps' },
  { keywords: ['helpdesk', 'ticket', 'support request'], category: 'IT', workType: 'Helpdesk' },
  { keywords: ['network', 'connectivity', 'dns', 'vpn'], category: 'IT', workType: 'Networking' },
  { keywords: ['monitoring', 'downtime', 'uptime', 'alerting'], category: 'IT', workType: 'Monitoring' },
  { keywords: ['marketing', 'campaign', 'content', 'branding', 'advertising'], category: 'BD/Mktg/Sales', workType: 'Marketing Campaign' },
  { keywords: ['lead generation', 'sales lead', 'prospect'], category: 'BD/Mktg/Sales', workType: 'Lead Generation' },
  { keywords: ['proposal', 'rfp', 'bid'], category: 'BD/Mktg/Sales', workType: 'Proposals' },
  { keywords: ['sales', 'revenue', 'deal', 'closing'], category: 'BD/Mktg/Sales', workType: 'Sales' },
  { keywords: ['interview', 'recruitment', 'hiring', 'candidate', 'technical interview'], category: 'HR', workType: 'Recruitment' },
  { keywords: ['onboarding', 'orientation', 'new hire'], category: 'HR', workType: 'Onboarding' },
  { keywords: ['policy', 'handbook', 'compliance'], category: 'HR', workType: 'Policy' },
  { keywords: ['training', 'workshop', 'upskilling'], category: 'HR', workType: 'Training' },
  { keywords: ['meeting', 'standup', 'sync', '1:1', 'catchup', 'tech lead', 'team lead'], category: 'General Work', workType: 'Meetings' },
  { keywords: ['documentation', 'wiki', 'readme', 'doc'], category: 'General Work', workType: 'Documentation' },
  { keywords: ['research', 'spike', 'investigation'], category: 'General Work', workType: 'Research' },
  { keywords: ['admin', 'administrative'], category: 'General Work', workType: 'Administrative' },
  { keywords: ['email', 'communication', 'update'], category: 'General Work', workType: 'Communication' },
  { keywords: ['budget', 'forecast', 'variance'], category: 'Finance', workType: 'Budgeting' },
  { keywords: ['reporting', 'report'], category: 'Finance', workType: 'Reporting' },
  { keywords: ['implementation', 'implement', 'rollout implementation', 'integration'], category: 'Projects', subCategory: 'Geniisys', workType: 'Implementation' },
  { keywords: ['enhancement', 'enhance', 'improvement'], category: 'Projects', subCategory: 'Geniisys', workType: 'Enhancement' },
  { keywords: ['maintenance', 'maintain', 'patch', 'hotfix', 'bugfix', 'bug fix'], category: 'Projects', subCategory: 'Geniisys', workType: 'Maintenance' },
  { keywords: ['testing', 'qa', 'uat'], category: 'Projects', subCategory: 'Geniisys', workType: 'Testing' },
  { keywords: ['support', 'assisting', 'assist'], category: 'Projects', subCategory: 'Geniisys', workType: 'Support' },
  { keywords: ['product development', 'product dev'], category: 'Projects', subCategory: 'Quick Policy', workType: 'Product Development' },
];
