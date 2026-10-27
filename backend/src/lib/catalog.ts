// The eight emergency services AegisGrid coordinates: names, what they handle,
// and what a station must provide to register. Pure data (shared with the web app).

import type { ServiceType } from "./types";

export interface ServiceInfo {
  type: ServiceType;
  name: string;
  helpline?: string;
  description: string;
  /** What one "unit" means for this service (shown on registration and dashboards). */
  unitLabel: string;
  /** Registration / licence number the station must provide, with a format check. */
  registration: { label: string; authority: string; example: string; pattern: string };
}

export const SERVICES: Record<ServiceType, ServiceInfo> = {
  AMBULANCE: {
    type: "AMBULANCE", name: "Ambulance", helpline: "108",
    description: "Emergency medical transport with basic and advanced life support crews.",
    unitLabel: "ambulances",
    registration: { label: "Ambulance service registration no.", authority: "State Health Department / RTO", example: "TN-EMS-2025-01234", pattern: "^[A-Z]{2}-[A-Z]{2,5}-\\d{4}-\\d{3,6}$" },
  },
  FIRE: {
    type: "FIRE", name: "Fire & Rescue", helpline: "101",
    description: "Fire suppression and rescue: building fires, vehicle fires, trapped persons.",
    unitLabel: "fire engines",
    registration: { label: "Fire station code", authority: "Tamil Nadu Fire & Rescue Services", example: "TNFRS-VLR-001", pattern: "^[A-Z]{3,6}-[A-Z]{2,4}-\\d{3}$" },
  },
  POLICE: {
    type: "POLICE", name: "Police", helpline: "100",
    description: "Law and order: crime in progress, violence, threats, scene security.",
    unitLabel: "patrol units",
    registration: { label: "Police station code (CCTNS)", authority: "State Police Department", example: "TN-VLR-PS-0042", pattern: "^[A-Z]{2}-[A-Z]{2,4}-PS-\\d{3,5}$" },
  },
  TRAFFIC_POLICE: {
    type: "TRAFFIC_POLICE", name: "Traffic Police", helpline: "103",
    description: "Road accidents, traffic control and clearing routes for emergency vehicles.",
    unitLabel: "traffic units",
    registration: { label: "Traffic police unit code", authority: "State Police Department (Traffic Wing)", example: "TN-VLR-TR-0007", pattern: "^[A-Z]{2}-[A-Z]{2,4}-TR-\\d{3,5}$" },
  },
  HOSPITAL: {
    type: "HOSPITAL", name: "Hospital Emergency",
    description: "Emergency departments that receive patients; a bed is reserved before arrival.",
    unitLabel: "emergency beds",
    registration: { label: "Clinical Establishment registration no.", authority: "Directorate of Medical & Rural Health Services", example: "CEA-TN-VLR-2024-0567", pattern: "^CEA-[A-Z]{2}-[A-Z]{2,4}-\\d{4}-\\d{3,6}$" },
  },
  DISASTER_RESPONSE: {
    type: "DISASTER_RESPONSE", name: "Disaster Response", helpline: "1078",
    description: "SDRF / NDRF teams for floods, building collapses, landslides and cyclones.",
    unitLabel: "rescue teams",
    registration: { label: "SDRF / NDRF unit code", authority: "State Disaster Management Authority", example: "SDRF-TN-VLR-03", pattern: "^(SDRF|NDRF)-[A-Z]{2}-[A-Z]{2,4}-\\d{2,3}$" },
  },
  WOMEN_CHILD_SAFETY: {
    type: "WOMEN_CHILD_SAFETY", name: "Women & Child Safety", helpline: "181 / 1098",
    description: "Harassment, domestic violence, child abuse and missing children.",
    unitLabel: "response teams",
    registration: { label: "Unit / helpline registration no.", authority: "Dept. of Social Welfare & Women Empowerment", example: "WCD-TN-VLR-0021", pattern: "^WCD-[A-Z]{2}-[A-Z]{2,4}-\\d{3,5}$" },
  },
  UTILITY_EMERGENCY: {
    type: "UTILITY_EMERGENCY", name: "Gas & Electricity Emergency", helpline: "1912",
    description: "LPG and gas leaks, fallen live wires, electrocution risk, transformer fires.",
    unitLabel: "field crews",
    registration: { label: "Utility licence / division code", authority: "TANGEDCO / Oil Marketing Company", example: "TNEB-VLR-DIV-12", pattern: "^[A-Z]{3,6}-[A-Z]{2,4}-DIV-\\d{1,3}$" },
  },
};

export const SERVICE_LIST = Object.values(SERVICES);

export function isValidRegistration(type: ServiceType, value: string): boolean {
  return new RegExp(SERVICES[type].registration.pattern).test(value.trim().toUpperCase());
}
