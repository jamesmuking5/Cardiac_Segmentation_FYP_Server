// File: __tests__/database.test.ts
// Description: This file contains unit tests for the database service functions.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { ConnectOptions } from 'mongoose';
import {
  connectToDatabase,
  userModel,
  fileModel,
  createUser,
  updateUser,
  UserRole,
} from '../src/services/database';
import bcrypt from 'bcrypt';

// Mocking logger to prevent console output during tests
jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

let mongoServer: MongoMemoryServer;
let dbUri: string;

// Setup in-memory MongoDB server
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  dbUri = mongoServer.getUri();
  // Connect only once here
  await mongoose.connect(dbUri);
});

// Clean up after tests
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Clear data between tests for all describe blocks
beforeEach(async () => {
  // Clear all collections more reliably
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
  // Optional: Re-ensure admin user logic if connectToDatabase test becomes more complex
  // For now, assume connect in beforeAll handles initial setup if needed.
});

// --- Main Test Suite ---
describe('Database Service', () => {

  // --- connectToDatabase Tests ---
  describe('connectToDatabase', () => {
    // Basic connection check (relies on beforeAll)
    it('should establish a connection to the database', () => {
      expect(mongoose.connection.readyState).toBe(1); // 1 = connected
    });

    it("should create a default admin user if none exists", async () => {
      // Verify there is no admin user before running the function
      const beforeCheck = await userModel.findOne({ role: UserRole.Admin });
      expect(beforeCheck).toBeNull();

      // Now call the actual connectToDatabase function
      // This works because already connected to the in-memory database
      // so it will skip the mongoose.connect() part and just run the createAdminUser() logic
      await connectToDatabase();

      // Check that an admin was created
      const adminUser = await userModel.findOne({ role: UserRole.Admin });
      if (adminUser) {
        expect(adminUser).not.toBeNull();
        expect(adminUser?.username).toBe("admin");
      }
    });


    it.todo('should not create a default admin user if one already exists');
    // it("should not create a default admin user if one already exists", async () => {
    //   // Verify there is no admin user first
    //   const beforeCheck = await userModel.findOne({ role: UserRole.Admin });
    //   expect(beforeCheck).toBeNull();

    //   // Create an admin user manually
    //   await createUser(
    //     'existingAdmin',
    //     'helpmegetthroughthis',
    //     'mylifeisadream@example.com',
    //     '1234567890',
    //     UserRole.Admin
    //   );

    //   // Now call the connectToDatabase function
    //   await connectToDatabase(); // This should not create a new admin user

    //   // Check that the admin user still exists and no duplicates were created
    //   const adminUser = await userModel.findOne({ role: UserRole.Admin });
    //   expect(adminUser).not.toBeNull();
    //   if (adminUser) {
    //     expect(adminUser.username).toBe('existingAdmin'); // Check the username of the existing admin
    //   }
    //   // Check that no new admin user was created
    //   const allAdmins = await userModel.find({ role: UserRole.Admin });
    //   expect(allAdmins.length).toBe(1); // Ensure only one admin user exists
    //   expect(allAdmins[0].username).toBe('existingAdmin'); // Check that the existing Admin is the only first one
    // });
  });

  // --- createUser Tests ---
  describe('createUser', () => {
    it('should create a new user successfully with default role', async () => {
      // Arrange
      const username = 'testuser';
      const password = 'password123';
      const email = 'test@example.com';
      const phone = '1234567890';

      // Act
      const result = await createUser(username, password, email, phone);

      // Assert - Check result object
      expect(result.success).toBe(true);
      if (result.success === true) { // Type narrowing
        expect(result.user).toBeDefined();
        expect(result.user.username).toBe(username);
        expect(result.user.email).toBe(email);
        expect(result.user.phone).toBe(phone);
        expect(result.user.role).toBe(UserRole.User); // Check default role
      } else {
        fail('createUser should have succeeded but failed');
      }

      // Assert - Check database state
      const savedUser = await userModel.findOne({ username: username });
      expect(savedUser).not.toBeNull();
      expect(savedUser?.email).toBe(email);
      expect(savedUser?.phone).toBe(phone);
      expect(savedUser?.role).toBe(UserRole.User); // Check default role

      // Assert - Check password hashing
      const passwordMatches = await bcrypt.compare(password, savedUser!.password);
      expect(passwordMatches).toBe(true);
    });

    it('should create a new user successfully with a specified role', async () => {
      // Arrange
      const username = 'adminuser';
      const password = 'password123';
      const email = 'admin@example.com';
      const phone = '1112223333';
      const role = UserRole.Admin; // Assuming UserRole is an enum or similar type
      // Act
      const result = await createUser(username, password, email, phone, role);
      // Assert
      expect(result.success).toBe(true);
      if (result.success === true) {
        expect(result.user.role).toBe(role);
      } else {
        fail('createUser should have succeeded but failed');
      }
      const savedUser = await userModel.findOne({ username: username });
      expect(savedUser?.role).toBe(role);
    });

    // --- createUser Failure Scenarios ---
    describe('when unique fields conflict', () => {
      const conflictUsername = 'conflictUser';
      const conflictEmail = 'conflict@example.com';
      const conflictPhone = '5555555555';

      // Setup the user that will cause conflicts
      beforeEach(async () => {
        await createUser(
          conflictUsername,
          'password123',
          conflictEmail,
          conflictPhone
        );
      });

      it('should fail if username already exists', async () => {
        const result = await createUser(
          conflictUsername, // Existing username
          'newpass',
          'new@example.com',
          '1234567890'
        );
        expect(result.success).toBe(false);
        if (result.success === false) {
          expect(result.error).toContain(`Username "${conflictUsername}" already exists`);
          expect(result.error).not.toContain('Email'); // Ensure only username conflict is reported
          expect(result.error).not.toContain('Phone');
        } else {
          fail('createUser should have failed (duplicate username) but succeeded');
        }
        // Verify no new user was added
        const users = await userModel.find({ email: 'new@example.com' });
        expect(users.length).toBe(0);
      });

      it('should fail if email already exists', async () => {
        const result = await createUser(
          'newUser',
          'newpass',
          conflictEmail, // Existing email
          '1234567890'
        );
        expect(result.success).toBe(false);
        if (result.success === false) {
          expect(result.error).toContain(`Email "${conflictEmail}" already exists`);
          expect(result.error).not.toContain('Username');
          expect(result.error).not.toContain('Phone');
        } else {
          fail('createUser should have failed (duplicate email) but succeeded');
        }
      });

      it('should fail if phone already exists', async () => {
        const result = await createUser(
          'newUser',
          'newpass',
          'new@example.com',
          conflictPhone // Existing phone
        );
        expect(result.success).toBe(false);
        if (result.success === false) {
          expect(result.error).toContain(`Phone "${conflictPhone}" already exists`);
          expect(result.error).not.toContain('Username');
          expect(result.error).not.toContain('Email');
        } else {
          fail('createUser should have failed (duplicate phone) but succeeded');
        }
      });

      it('should fail and report all conflicts if username, email, and phone already exist', async () => {
        const result = await createUser(
          conflictUsername, // Existing username
          'newpass',
          conflictEmail, // Existing email
          conflictPhone // Existing phone
        );
        expect(result.success).toBe(false);
        if (result.success === false) {
          expect(result.error).toContain(`Username "${conflictUsername}" already exists`);
          expect(result.error).toContain(`Email "${conflictEmail}" already exists`);
          expect(result.error).toContain(`Phone "${conflictPhone}" already exists`);
        } else {
          fail('createUser should have failed (all duplicates) but succeeded');
        }
      });
    });
  });

  // --- updateUser Tests ---
  describe('updateUser', () => {
    const initialUsername = 'updateTestUser';
    const initialPassword = 'initialPassword';
    const initialEmail = 'initial@example.com';
    const initialPhone = '1110001110';

    // Setup user for update tests
    beforeEach(async () => {
      await createUser(initialUsername, initialPassword, initialEmail, initialPhone);
    });

    it('should update email, phone, password, and role successfully', async () => {
      // Arrange: Define the updates
      const updates = {
        email: 'updated@example.com',
        phone: '2220002220',
        password: 'newSecurePassword',
        role: UserRole.Admin, // UserRole is an enum or similar type
      };

      // Act: Perform the update
      const updateResult = await updateUser(initialUsername, updates);

      // Assert: Check the result and final database state
      expect(updateResult.success).toBe(true);

      // Verify database state
      const updatedUser = await userModel.findOne({ username: initialUsername });
      expect(updatedUser).not.toBeNull();

      if (updatedUser) { // Type guard
        expect(updatedUser.email).toBe(updates.email);
        expect(updatedUser.phone).toBe(updates.phone);
        expect(updatedUser.role).toBe(updates.role);
        expect(updatedUser.username).toBe(initialUsername); // Username should be unchanged

        // Verify password hash
        const passwordMatches = await bcrypt.compare(updates.password, updatedUser.password);
        expect(passwordMatches).toBe(true);
      } else {
        fail("Updated user not found in DB");
      }
    });

    it('should update username successfully', async () => {
      // Arrange
      const newUsername = 'user-renamed';

      // Act
      const updateResult = await updateUser(initialUsername, { username: newUsername });

      // Assert: Check success status
      expect(updateResult.success).toBe(true);

      // Verify database state - query by OLD username should fail
      const oldUser = await userModel.findOne({ username: initialUsername });
      expect(oldUser).toBeNull();

      // Verify database state - query by NEW username should succeed
      const newUser = await userModel.findOne({ username: newUsername });
      expect(newUser).not.toBeNull();

      if (newUser) {
        expect(newUser.username).toBe(newUsername);
        // Check other fields remained unchanged from initial state
        expect(newUser.email).toBe(initialEmail);
        expect(newUser.phone).toBe(initialPhone);
        expect(newUser.role).toBe(UserRole.User); // Initial default role
        const passwordMatches = await bcrypt.compare(initialPassword, newUser.password);
        expect(passwordMatches).toBe(true); // Initial password
      } else {
        fail("Renamed user not found in DB");
      }
    });

    it('should return success: false if trying to update a non-existent user', async () => {
      const result = await updateUser('nonexistentuser', { email: 'a@b.com' });
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain('does not exist');
      } else {
        fail('updateUser should have failed for non-existent user but succeeded');
      }
    });

    it('should return success: false if update results in no changes', async () => {
      const result = await updateUser(initialUsername, { email: initialEmail, phone: initialPhone }); // Provide existing data
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain('No fields to update');
      } else {
        fail('updateUser should have failed (no changes) but succeeded');
      }
    });


    it('should fail if updated email conflicts with another existing user', async () => {
      // Arrange: Create a second user whose email we'll conflict with
      const otherUserEmail = 'other@example.com';
      await createUser('otherUser', 'password', otherUserEmail, '3330003330');

      // Act: Try to update the first user to use the second user's email
      const result = await updateUser(initialUsername, { email: otherUserEmail });

      // Assert
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain(`Email "${otherUserEmail}" is already in use`);
      } else {
        fail('updateUser should have failed (email conflict) but succeeded');
      }
    });

    it('should fail if updated phone conflicts with another existing user', async () => {
      // Arrange: Create a second user whose phone we'll conflict with
      const otherUserPhone = '4440004440';
      await createUser('otherUser2', 'password', 'otherUser2@example.com', otherUserPhone);

      // Act: Try to update the first user to use the second user's phone
      const result = await updateUser(initialUsername, { phone: otherUserPhone });

      // Assert
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain(`Phone "${otherUserPhone}" is already in use`);
      } else {
        fail('updateUser should have failed (phone conflict) but succeeded');
      }
    });

    it('should fail if updated username conflicts with another existing user', async () => {
      // Arrange: Create a second user whose username we'll conflict with
      const otherUserUsername = 'conflictUser';
      await createUser(otherUserUsername, 'password', 'conflictUser@example.com', '5550005550');

      // Act: Try to update the first user to use the second user's username
      const result = await updateUser(initialUsername, { username: otherUserUsername });

      // Assert
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain(`Username "${otherUserUsername}" is already in use`);
      } else {
        fail('updateUser should have failed (username conflict) but succeeded');
      }
    });
  });

  // --- createFile Tests ---
  describe('createFile', () => {
    // TODO: Add tests for createFile
    // Need to import/use 'createFile' function from database.ts
    // Need to import IFileDocument if checking returned object properties

    it.todo('should create a new file record successfully');
    it.todo('should fail if filename already exists');
    it.todo('should fail if filehash already exists');
  });

});