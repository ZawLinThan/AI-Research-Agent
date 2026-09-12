import { apiRequest } from "./authApi";

export const researchApi = <T>(
  path = "",
  options: RequestInit = {},
): Promise<T> => apiRequest<T>(`/research${path}`, options);
