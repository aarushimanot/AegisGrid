// Reference stations around Vellore (approximate positions), two per service.
// Used to seed a deployment (scripts/seed-stations.ts) and by the web app's demo
// mode. Each entry gets its own service login so it can be operated live.

import type { ServiceType } from "./types";

export interface SeedStation {
  key: string; // stable id and login prefix
  serviceType: ServiceType;
  name: string;
  registrationNumber: string;
  issuingAuthority: string;
  contactPerson: { name: string; designation: string };
  phone: string;
  address: string;
  location: { lat: number; lon: number };
  unitsTotal: number;
}

export const SEED_PASSWORD = "Station@123";
export const seedEmail = (key: string) => `${key}@aegisgrid.demo`;

export const VELLORE_STATIONS: SeedStation[] = [
  { key: "katpadi-108", serviceType: "AMBULANCE", name: "108 Ambulance — Katpadi Base", registrationNumber: "TN-EMS-2025-01231", issuingAuthority: "Tamil Nadu Health Department", contactPerson: { name: "R. Suresh", designation: "Base Supervisor" }, phone: "+919840000101", address: "Katpadi Junction Road, Katpadi, Vellore 632007", location: { lat: 12.9716, lon: 79.1376 }, unitsTotal: 3 },
  { key: "town-108", serviceType: "AMBULANCE", name: "108 Ambulance — Vellore Town Base", registrationNumber: "TN-EMS-2025-01232", issuingAuthority: "Tamil Nadu Health Department", contactPerson: { name: "M. Priya", designation: "Base Supervisor" }, phone: "+919840000102", address: "New Bus Stand, Vellore 632004", location: { lat: 12.934, lon: 79.146 }, unitsTotal: 4 },
  { key: "vellore-fire", serviceType: "FIRE", name: "Vellore Fire & Rescue Station", registrationNumber: "TNFRS-VLR-001", issuingAuthority: "Tamil Nadu Fire & Rescue Services", contactPerson: { name: "K. Ramesh", designation: "Station Officer" }, phone: "+919840000201", address: "Officers Line, Vellore 632001", location: { lat: 12.92, lon: 79.13 }, unitsTotal: 2 },
  { key: "katpadi-fire", serviceType: "FIRE", name: "Katpadi Fire & Rescue Station", registrationNumber: "TNFRS-VLR-002", issuingAuthority: "Tamil Nadu Fire & Rescue Services", contactPerson: { name: "S. Anand", designation: "Station Officer" }, phone: "+919840000202", address: "Chittoor Road, Katpadi, Vellore 632007", location: { lat: 12.98, lon: 79.14 }, unitsTotal: 2 },
  { key: "katpadi-police", serviceType: "POLICE", name: "Katpadi Police Station", registrationNumber: "TN-VLR-PS-0042", issuingAuthority: "Tamil Nadu Police", contactPerson: { name: "Insp. V. Karthik", designation: "Inspector of Police" }, phone: "+919840000301", address: "Katpadi Main Road, Vellore 632007", location: { lat: 12.969, lon: 79.144 }, unitsTotal: 3 },
  { key: "vellore-north-police", serviceType: "POLICE", name: "Vellore North Police Station", registrationNumber: "TN-VLR-PS-0011", issuingAuthority: "Tamil Nadu Police", contactPerson: { name: "Insp. L. Meena", designation: "Inspector of Police" }, phone: "+919840000302", address: "Arcot Road, Vellore 632004", location: { lat: 12.93, lon: 79.134 }, unitsTotal: 3 },
  { key: "katpadi-traffic", serviceType: "TRAFFIC_POLICE", name: "Traffic Police — Katpadi Unit", registrationNumber: "TN-VLR-TR-0007", issuingAuthority: "Tamil Nadu Police (Traffic)", contactPerson: { name: "SI P. Raja", designation: "Sub-Inspector (Traffic)" }, phone: "+919840000401", address: "Katpadi Junction Signal, Vellore 632007", location: { lat: 12.9712, lon: 79.139 }, unitsTotal: 2 },
  { key: "town-traffic", serviceType: "TRAFFIC_POLICE", name: "Traffic Police — Vellore Town Unit", registrationNumber: "TN-VLR-TR-0003", issuingAuthority: "Tamil Nadu Police (Traffic)", contactPerson: { name: "SI N. Divya", designation: "Sub-Inspector (Traffic)" }, phone: "+919840000402", address: "Green Circle, Vellore 632004", location: { lat: 12.934, lon: 79.14 }, unitsTotal: 2 },
  { key: "cmc-er", serviceType: "HOSPITAL", name: "CMC Vellore — Emergency Department", registrationNumber: "CEA-TN-VLR-2024-0001", issuingAuthority: "Directorate of Medical & Rural Health Services", contactPerson: { name: "Dr. A. Joseph", designation: "Head, Emergency Medicine" }, phone: "+919840000501", address: "Ida Scudder Road, Vellore 632004", location: { lat: 12.9249, lon: 79.1353 }, unitsTotal: 12 },
  { key: "naruvi-er", serviceType: "HOSPITAL", name: "Naruvi Hospitals — Emergency", registrationNumber: "CEA-TN-VLR-2024-0567", issuingAuthority: "Directorate of Medical & Rural Health Services", contactPerson: { name: "Dr. S. Lakshmi", designation: "ER Consultant" }, phone: "+919840000502", address: "Collector Office Road, Vellore 632004", location: { lat: 12.947, lon: 79.152 }, unitsTotal: 6 },
  { key: "sdrf-vellore", serviceType: "DISASTER_RESPONSE", name: "SDRF Vellore Unit", registrationNumber: "SDRF-TN-VLR-03", issuingAuthority: "Tamil Nadu State Disaster Management Authority", contactPerson: { name: "Cmdt. G. Selvam", designation: "Unit Commander" }, phone: "+919840000601", address: "Sathuvachari, Vellore 632009", location: { lat: 12.938, lon: 79.163 }, unitsTotal: 2 },
  { key: "ndrf-arakkonam", serviceType: "DISASTER_RESPONSE", name: "NDRF 4th Battalion, Arakkonam", registrationNumber: "NDRF-TN-ARK-04", issuingAuthority: "National Disaster Response Force", contactPerson: { name: "Cmdt. R. Prasad", designation: "Commandant" }, phone: "+919840000602", address: "INS Rajali Road, Arakkonam 631006", location: { lat: 13.084, lon: 79.671 }, unitsTotal: 4 },
  { key: "awps-vellore", serviceType: "WOMEN_CHILD_SAFETY", name: "All Women Police Station, Vellore", registrationNumber: "WCD-TN-VLR-0021", issuingAuthority: "Dept. of Social Welfare & Women Empowerment", contactPerson: { name: "Insp. K. Revathi", designation: "Inspector, AWPS" }, phone: "+919840000701", address: "Anna Salai, Vellore 632001", location: { lat: 12.925, lon: 79.133 }, unitsTotal: 2 },
  { key: "childline-vellore", serviceType: "WOMEN_CHILD_SAFETY", name: "Childline 1098 — Vellore", registrationNumber: "WCD-TN-VLR-0034", issuingAuthority: "Ministry of Women & Child Development", contactPerson: { name: "J. Mary", designation: "District Coordinator" }, phone: "+919840000702", address: "Gandhi Nagar, Vellore 632006", location: { lat: 12.956, lon: 79.138 }, unitsTotal: 2 },
  { key: "tangedco-vellore", serviceType: "UTILITY_EMERGENCY", name: "TANGEDCO Vellore Division — Emergency", registrationNumber: "TNEB-VLR-DIV-12", issuingAuthority: "Tamil Nadu Generation & Distribution Corp.", contactPerson: { name: "AE M. Kumar", designation: "Assistant Engineer" }, phone: "+919840000801", address: "Bangalore Road, Vellore 632001", location: { lat: 12.933, lon: 79.129 }, unitsTotal: 3 },
  { key: "indane-katpadi", serviceType: "UTILITY_EMERGENCY", name: "Indane LPG Emergency — Katpadi", registrationNumber: "IOCL-VLR-DIV-03", issuingAuthority: "Indian Oil Corporation (LPG)", contactPerson: { name: "T. Ravi", designation: "Emergency Cell In-charge" }, phone: "+919840000802", address: "Gandhi Road, Katpadi, Vellore 632007", location: { lat: 12.975, lon: 79.145 }, unitsTotal: 2 },
];
