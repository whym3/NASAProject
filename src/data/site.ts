// Site-wide content. Items marked placeholder are assumptions for the team to replace.
export const site = {
  name: 'Blinkscope',
  role: 'SPHEREx blink comparator',
  // Set NEXT_PUBLIC_SITE_URL to a custom domain if there is one. On Vercel the address is
  // picked up automatically: the production domain if this is production, else the deployment's own.
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' && process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : 'http://localhost:3000'),
  description:
    'Enter a sky position and blink real SPHEREx infrared images of it across time. Whatever jumps between plates is moving. A NASA Space Apps 2026 project.',
  // placeholder: put the real team name here and set placeholder to false; the footer then credits it
  team: { name: 'Team name', placeholder: true },
  // The source code: the branch this site is built from.
  repoUrl: 'https://github.com/whym3/NASAProject/tree/sitev2',
  challengeUrl: 'https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/',
  acknowledgement:
    'This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.',
  nav: [
    { href: '/view', label: 'Viewer' },
    { href: '/targets', label: 'Targets' },
    { href: '/craft', label: 'Observatory' },
    { href: '/method', label: 'Method' },
  ],
};
