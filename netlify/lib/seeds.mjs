// Общие подборки для всех подписчиков (бывший config/searches.yaml).

export const SEEDS = [
  {
    id: "terapevt", name: "Врач-терапевт", text: "врач терапевт",
    search_field: "everywhere", area: [113], schedule: [], employment: [],
    experience: [], salary_from: 0, only_with_salary: false, search_period: 3,
    min_employer_rating: 0, exclude_keywords: [], max_results: 50, enabled: true,
  },
  {
    id: "telemed", name: "Телемедицина", text: "телемедицина",
    search_field: "everywhere", area: [113], schedule: [], employment: [],
    experience: [], salary_from: 0, only_with_salary: false, search_period: 3,
    min_employer_rating: 0, exclude_keywords: [], max_results: 50, enabled: true,
  },
];
