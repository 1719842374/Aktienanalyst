// Storage interface - not used for this app but required by template
export interface IStorage {}

export class MemStorage implements IStorage {}

export const storage = new MemStorage();
