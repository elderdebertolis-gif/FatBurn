import { FitnessObjective } from "../types";

export function calculateBmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  if (!heightM || !weightKg) {
    return 0;
  }

  return Number((weightKg / (heightM * heightM)).toFixed(1));
}

export function getBmiClass(bmi: number): string {
  if (bmi < 18.5) {
    return "Abaixo do peso";
  }
  if (bmi < 25) {
    return "Peso adequado";
  }
  if (bmi < 30) {
    return "Sobrepeso";
  }
  return "Obesidade";
}

export function getObjectiveLabel(objective: FitnessObjective): string {
  return objective === "perda_de_peso" ? "Perda de peso" : "Definicao";
}
