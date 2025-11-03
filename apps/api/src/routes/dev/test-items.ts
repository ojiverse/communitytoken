/**
 * Test Items HTTP Routes - CRUD endpoints for database verification
 *
 * This is a TEMPORARY route file used to validate database operations.
 * DELETE this file after verification is complete.
 *
 * Endpoints:
 * - GET /dev/test-items - List all items
 * - POST /dev/test-items - Create new item
 * - GET /dev/test-items/:id - Get item by ID
 * - DELETE /dev/test-items/:id - Delete item
 */

import { Hono } from 'hono'
import type { Env } from '../../lib/types.ts'
import type { ITestItemRepository } from '../../repositories/dev/ITestItemRepository.ts'
import { AsTestItemID, TestItemEntity } from '../../entities/dev/TestItemEntity.ts'

/**
 * Request body type for creating test items
 */
type CreateTestItemRequest = {
  name: string
  value: number
}

/**
 * Creates a Hono router for test-items endpoints
 *
 * Uses dependency injection to receive repository implementation,
 * allowing for easy testing and swapping implementations.
 *
 * @param repository - ITestItemRepository implementation
 * @returns Hono router instance
 */
export function createTestItemsRouter(repository: ITestItemRepository): Hono<Env> {
  const router = new Hono<Env>()

  /**
   * GET /dev/test-items
   * List all test items
   */
  router.get('/', async (c) => {
    try {
      const items = await repository.findAll()
      return c.json({
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          value: item.value,
          createdAt: item.createdAt,
        })),
      })
    } catch (error) {
      console.error('Failed to fetch test items:', error)
      return c.json(
        {
          error: 'Failed to fetch test items',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  })

  /**
   * POST /dev/test-items
   * Create a new test item
   */
  router.post('/', async (c) => {
    try {
      const body = await c.req.json() as CreateTestItemRequest

      // Validate request body
      if (!body.name || typeof body.name !== 'string') {
        return c.json({ error: 'Invalid request: name is required and must be a string' }, 400)
      }
      if (typeof body.value !== 'number') {
        return c.json({ error: 'Invalid request: value is required and must be a number' }, 400)
      }

      // Create entity and save to database
      const item = TestItemEntity.create(body.name, body.value)
      const created = await repository.create(item)

      return c.json(
        {
          item: {
            id: created.id,
            name: created.name,
            value: created.value,
            createdAt: created.createdAt,
          },
        },
        201,
      )
    } catch (error) {
      console.error('Failed to create test item:', error)
      return c.json(
        {
          error: 'Failed to create test item',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  })

  /**
   * GET /dev/test-items/:id
   * Get a test item by ID
   */
  router.get('/:id', async (c) => {
    try {
      const id = AsTestItemID(c.req.param('id'))
      const item = await repository.findById(id)

      if (!item) {
        return c.json({ error: 'Test item not found' }, 404)
      }

      return c.json({
        item: {
          id: item.id,
          name: item.name,
          value: item.value,
          createdAt: item.createdAt,
        },
      })
    } catch (error) {
      console.error('Failed to fetch test item:', error)
      return c.json(
        {
          error: 'Failed to fetch test item',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  })

  /**
   * DELETE /dev/test-items/:id
   * Delete a test item by ID
   */
  router.delete('/:id', async (c) => {
    try {
      const id = AsTestItemID(c.req.param('id'))
      const deleted = await repository.delete(id)

      if (!deleted) {
        return c.json({ error: 'Test item not found' }, 404)
      }

      return c.json({ message: 'Test item deleted successfully' })
    } catch (error) {
      console.error('Failed to delete test item:', error)
      return c.json(
        {
          error: 'Failed to delete test item',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  })

  return router
}
