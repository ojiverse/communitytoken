/**
 * TestItemEntity - Domain entity for database verification
 *
 * This is a TEMPORARY entity used to validate database operations.
 * DELETE this file after verification is complete.
 *
 * Pure domain entity with no database dependencies.
 * Database mapping is handled by the Repository layer.
 */

// Branded Type for type-safe ID
const TestItemIDBrand: unique symbol = Symbol("TestItemID");
export type TestItemID = string & { readonly [TestItemIDBrand]: never };

/**
 * Casts a string to TestItemID (branded type)
 * Use this function to create TestItemID from UUID strings
 *
 * @param id - UUID string
 * @returns Branded TestItemID
 */
export function AsTestItemID(id: string): TestItemID {
  return id as TestItemID;
}

/**
 * TestItemEntity represents a test item in the domain layer
 *
 * This entity demonstrates clean domain modeling with:
 * - Branded types for compile-time type safety
 * - Invariant validation in constructor
 * - Factory method for creation
 * - No database concerns (handled by Repository layer)
 */
export class TestItemEntity {
  constructor(
    public readonly id: TestItemID,
    public readonly name: string,
    public readonly value: number,
    public readonly createdAt: number,
  ) {
    // Validate invariants
    if (name.trim().length === 0) {
      throw new Error("Name cannot be empty");
    }
    if (value < 0) {
      throw new Error("Value must be non-negative");
    }
    if (createdAt <= 0) {
      throw new Error("CreatedAt must be positive");
    }
  }

  /**
   * Factory method to create a new TestItemEntity
   *
   * @param name - Item name (non-empty)
   * @param value - Item value (non-negative)
   * @returns New TestItemEntity instance
   */
  static create(name: string, value: number): TestItemEntity {
    const id = AsTestItemID(crypto.randomUUID());
    const createdAt = Date.now();
    return new TestItemEntity(id, name, value, createdAt);
  }
}
