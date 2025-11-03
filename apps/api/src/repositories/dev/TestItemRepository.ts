/**
 * TestItemRepository - Supabase implementation of ITestItemRepository
 *
 * This is a TEMPORARY repository used to validate database operations.
 * DELETE this file after verification is complete.
 *
 * Demonstrates:
 * - Repository pattern with Supabase
 * - Entity-based data access
 * - Database row to entity mapping
 * - Error handling for database operations
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ITestItemRepository } from "./ITestItemRepository.ts";
import {
  AsTestItemID,
  TestItemEntity,
  type TestItemID,
} from "../../entities/dev/TestItemEntity.ts";

/**
 * Database row type matching dev_test_items table schema
 */
type DevTestItemRow = {
  id: string;
  name: string;
  value: number;
  created_at: number;
};

/**
 * Supabase implementation of TestItem repository
 */
export class TestItemRepository implements ITestItemRepository {
  private readonly tableName = "dev_test_items";

  constructor(private readonly client: SupabaseClient) {}

  /**
   * Maps database row to domain entity
   *
   * @param row - Database row from Supabase
   * @returns TestItemEntity instance
   */
  private fromDatabase(row: DevTestItemRow): TestItemEntity {
    return new TestItemEntity(
      AsTestItemID(row.id),
      row.name,
      row.value,
      row.created_at,
    );
  }

  /**
   * Maps domain entity to database row
   *
   * @param entity - TestItemEntity instance
   * @returns Database row object
   */
  private toDatabase(entity: TestItemEntity): DevTestItemRow {
    return {
      id: entity.id,
      name: entity.name,
      value: entity.value,
      created_at: entity.createdAt,
    };
  }

  /**
   * Retrieves all test items from the database
   *
   * @returns Promise resolving to array of TestItemEntity
   * @throws Error if database query fails
   */
  async findAll(): Promise<TestItemEntity[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch test items: ${error.message}`);
    }

    return (data as DevTestItemRow[]).map((row) => this.fromDatabase(row));
  }

  /**
   * Retrieves a single test item by ID
   *
   * @param id - TestItemID (branded type)
   * @returns Promise resolving to TestItemEntity or null if not found
   * @throws Error if database query fails
   */
  async findById(id: TestItemID): Promise<TestItemEntity | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      // PGRST116: Row not found - return null instead of throwing
      if (error.code === "PGRST116") {
        return null;
      }
      throw new Error(`Failed to fetch test item by ID: ${error.message}`);
    }

    return this.fromDatabase(data as DevTestItemRow);
  }

  /**
   * Creates a new test item in the database
   *
   * @param item - TestItemEntity to create
   * @returns Promise resolving to created TestItemEntity
   * @throws Error if database insert fails
   */
  async create(item: TestItemEntity): Promise<TestItemEntity> {
    const dbRow = this.toDatabase(item);

    const { data, error } = await this.client
      .from(this.tableName)
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create test item: ${error.message}`);
    }

    return this.fromDatabase(data as DevTestItemRow);
  }

  /**
   * Deletes a test item by ID
   *
   * @param id - TestItemID (branded type)
   * @returns Promise resolving to true if deleted, false if not found
   * @throws Error if database delete fails
   */
  async delete(id: TestItemID): Promise<boolean> {
    const { error, count } = await this.client
      .from(this.tableName)
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to delete test item: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }
}
