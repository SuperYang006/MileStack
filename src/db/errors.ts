export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class DatabaseOpenError extends DatabaseError {}

export class DatabaseBackupError extends DatabaseError {}

export class DatabaseMigrationError extends DatabaseError {}
