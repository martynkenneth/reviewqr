// Marketing wording for each industry. The app itself works the same for
// everyone; only the landing page changes. The first entry is the home page
// (or set DEFAULT_INDUSTRY). To target a new industry, copy an entry, change
// the wording, and it gets its own page at /<slug>.
const industries = {
  trades: {
    slug: 'trades',
    title: 'Google review QR codes for tradespeople',
    eyebrow: 'For plumbers, sparkies, builders and every trade',
    headline: 'Get more Google reviews before you leave the job.',
    lead: 'Create your branded review QR code, show it to your customer, and send them straight to your Google review page.',
    example: { name: 'ABC Plumbing', initials: 'AP', colour: '#1d4ed8' },
    steps: [
      ['Finish the job', 'Open your review screen with one tap.'],
      ['Show or share your QR', 'Your customer scans it with their phone camera.'],
      ['Customer reviews you on Google', 'They write and submit the review directly on Google.'],
    ],
    printFeature: ['Download for invoices, vans and cards', 'High-res PNG, SVG for signwriters, and A6, A5 and A4 print-ready PDFs.'],
    printedThings: 'cards, vans and signs',
    finalCta: 'Ready before your next job?',
  },
};

const DEFAULT = process.env.DEFAULT_INDUSTRY && industries[process.env.DEFAULT_INDUSTRY] ? process.env.DEFAULT_INDUSTRY : 'trades';

module.exports = { industries, defaultIndustry: industries[DEFAULT] };
