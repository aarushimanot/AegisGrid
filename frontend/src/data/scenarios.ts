// Presentation scenarios: realistic citizen reports around Vellore, so the full
// flow can be demonstrated without real accident photos. In demo mode the
// `simulated` fields stand in for what the AI perception pipeline (Rekognition
// labels, Transcribe + Translate) would extract from real evidence.

export interface Scenario {
  id: string;
  title: string;
  description: string;
  address: string;
  location: { lat: number; lon: number };
  simulated?: { labels?: string[]; transcript?: string };
  evidence: string; // what the "uploaded proof" represents
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'accident', title: 'Road accident',
    description: 'A car hit a motorbike at the VIT main gate. The rider is bleeding heavily and not responding.',
    address: 'VIT Main Gate, Katpadi Road, Vellore', location: { lat: 12.9695, lon: 79.1565 },
    simulated: { labels: ['Car Crash', 'Motorcycle', 'Vehicle', 'Person'] }, evidence: 'Photo of the crash scene',
  },
  {
    id: 'fire', title: 'House fire',
    description: 'Fire in a two-storey house in Gandhi Nagar, thick black smoke, an elderly woman is still inside.',
    address: 'Gandhi Nagar, Vellore', location: { lat: 12.9560, lon: 79.1385 },
    simulated: { labels: ['Fire', 'Smoke', 'Building'] }, evidence: 'Video of the burning house',
  },
  {
    id: 'medical', title: 'Medical emergency',
    description: 'My father collapsed with severe chest pain and is struggling to breathe.',
    address: 'Sathuvachari, Vellore', location: { lat: 12.9410, lon: 79.1610 }, evidence: 'Text only',
  },
  {
    id: 'harassment', title: 'Harassment',
    description: 'A man has been following and harassing me near the Katpadi bus stand. I feel unsafe.',
    address: 'Katpadi Bus Stand, Vellore', location: { lat: 12.9716, lon: 79.1378 }, evidence: 'Text only',
  },
  {
    id: 'gas', title: 'Gas leak',
    description: 'Strong smell of gas, the LPG cylinder in our hostel kitchen is leaking.',
    address: 'Hostel, Katpadi, Vellore', location: { lat: 12.9740, lon: 79.1500 }, evidence: 'Text only',
  },
  {
    id: 'flood', title: 'Flood',
    description: 'Flooding near the Palar river, water is entering houses and families are stranded on rooftops.',
    address: 'Palar Riverbank, Thottapalayam, Vellore', location: { lat: 12.9100, lon: 79.1450 },
    simulated: { labels: ['Flood', 'Water', 'Building'] }, evidence: 'Photo of the flooded street',
  },
  {
    id: 'voice', title: 'Hindi voice note',
    description: '',
    address: 'Officers Line, Vellore', location: { lat: 12.9280, lon: 79.1370 },
    simulated: { transcript: '(Hindi voice note, translated) There has been a road accident at Officers Line, two people are injured and one is bleeding.' },
    evidence: 'Voice recording in Hindi',
  },
];
