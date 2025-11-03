/**
 * ITestItemRepository - Repository interface for TestItem data access
 *
 * This is a TEMPORARY interface used to validate the Repository Pattern.
 * DELETE this file after verification is complete.
 *
 * The repository pattern provides:
 * - Abstraction over data access implementation
 * - Testability through interface mocking
 * - Clean separation between domain and infrastructure
 */

import type { TestItemEntity, TestItemID } from '../../entities/dev/TestItemEntity.ts'

/**
 * Repository contract for TestItem data access operations
 * All methods use Entity types (not raw database types)
 */
export interface ITestItemRepository {
  /**
   * Retrieves all test items from the database
   *
   * @returns Promise resolving to array of TestItemEntity
   */
  findAll(): Promise<TestItemEntity[]>

  /**
   * Retrieves a single test item by ID
   *
   * @param id - TestItemID (branded type)
   * @returns Promise resolving to TestItemEntity or null if not found
   */
  findById(id: TestItemID): Promise<TestItemEntity | null>

  /**
   * Creates a new test item in the database
   *
   * @param item - TestItemEntity to create
   * @returns Promise resolving to created TestItemEntity
   */
  create(item: TestItemEntity): Promise<TestItemEntity>

  /**
   * Deletes a test item by ID
   *
   * @param id - TestItemID (branded type)
   * @returns Promise resolving to true if deleted, false if not found
   */
  delete(id: TestItemID): Promise<boolean>
}
