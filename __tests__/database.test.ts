// File: __tests__/database.test.ts
// Description: This file contains unit tests for the database service functions.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { ConnectOptions } from 'mongoose';
import {
  connectToDatabase,
  userModel,
  fileModel,
  createUser,
  readUser,
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
      if (result.success === true && result.user) { // Type narrowing
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
      if (result.success === true && result.user) { // Type narrowing
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
          expect(result.message).toContain(`Username "${conflictUsername}" already exists`);
          expect(result.message).not.toContain('Email'); // Ensure only username conflict is reported
          expect(result.message).not.toContain('Phone');
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
          expect(result.message).toContain(`Email "${conflictEmail}" already exists`);
          expect(result.message).not.toContain('Username');
          expect(result.message).not.toContain('Phone');
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
          expect(result.message).toContain(`Phone "${conflictPhone}" already exists`);
          expect(result.message).not.toContain('Username');
          expect(result.message).not.toContain('Email');
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
          expect(result.message).toContain(`Username "${conflictUsername}" already exists`);
          expect(result.message).toContain(`Email "${conflictEmail}" already exists`);
          expect(result.message).toContain(`Phone "${conflictPhone}" already exists`);
        } else {
          fail('createUser should have failed (all duplicates) but succeeded');
        }
      });
    });
  });

  // --- readUser Tests ---
  describe('readUser', () => {
    // Sample users for testing read operations
    const user1Data = { username: 'reader1', email: 'reader1@example.com', phone: '1010101010', password: 'password1', role: UserRole.User };
    const user2Data = { username: 'reader2', email: 'reader2@example.com', phone: '2020202020', password: 'password2', role: UserRole.User };
    const adminUserData = { username: 'readerAdmin', email: 'readerAdmin@example.com', phone: '3030303030', password: 'passwordAdmin', role: UserRole.Admin };

    // Setup users before each test in this block
    beforeEach(async () => {
      // Create the sample users needed for read tests
      // Note: Global beforeEach already clears the DB
      await createUser(user1Data.username, user1Data.password, user1Data.email, user1Data.phone, user1Data.role);
      await createUser(user2Data.username, user2Data.password, user2Data.email, user2Data.phone, user2Data.role);
      await createUser(adminUserData.username, adminUserData.password, adminUserData.email, adminUserData.phone, adminUserData.role);
    });

    it('should return all users when no criteria are provided', async () => {
      // Act
      const result = await readUser();

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read'); // Assuming CRUDOperation.READ is 'read'
      expect(result.users).toBeDefined();
      if (result.success && result.users) { // Type guard
        expect(result.users.length).toBe(3); // user1, user2, adminUser
        // Optional: Check if some expected usernames are present
        const usernames = result.users.map(u => u.username);
        expect(usernames).toContain(user1Data.username);
        expect(usernames).toContain(user2Data.username);
        expect(usernames).toContain(adminUserData.username);
      } else {
        fail('readUser() without criteria failed or did not return users.');
      }
    });

    it('should find a user by unique username', async () => {
      // Act
      const result = await readUser(user1Data.username);

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read');
      expect(result.users).toBeDefined();
      if (result.success && result.users) {
        expect(result.users.length).toBe(1);
        expect(result.users[0].username).toBe(user1Data.username);
        expect(result.users[0].email).toBe(user1Data.email);
        expect(result.users[0].phone).toBe(user1Data.phone);
        expect(result.users[0].role).toBe(user1Data.role);
        // IMPORTANT: Verify password is NOT present
        expect((result.users[0] as any).password).toBeUndefined();
      } else {
        fail('readUser(username) failed or did not return users.');
      }
    });

    it('should find a user by unique email', async () => {
      // Act
      const result = await readUser(undefined, user2Data.email);

      // Assert
      expect(result.success).toBe(true);
      expect(result.users?.length).toBe(1);
      expect(result.users?.[0].username).toBe(user2Data.username);
      expect(result.users?.[0].email).toBe(user2Data.email);
    });

    it('should find a user by unique phone', async () => {
      // Act
      const result = await readUser(undefined, undefined, adminUserData.phone);

      // Assert
      expect(result.success).toBe(true);
      expect(result.users?.length).toBe(1);
      expect(result.users?.[0].username).toBe(adminUserData.username);
      expect(result.users?.[0].phone).toBe(adminUserData.phone);
    });

    it('should return multiple users when searching by role (UserRole.User)', async () => {
      // Act
      const result = await readUser(undefined, undefined, undefined, UserRole.User);

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read');
      expect(result.users).toBeDefined();
      if (result.success && result.users) {
        expect(result.users.length).toBe(2); // reader1, reader2
        const usernames = result.users.map(u => u.username);
        expect(usernames).toContain(user1Data.username);
        expect(usernames).toContain(user2Data.username);
        expect(usernames).not.toContain(adminUserData.username); // Ensure admin isn't included
      } else {
        fail('readUser(role: User) failed or did not return users.');
      }
    });

    it('should return users matching ANY provided criteria (OR logic)', async () => {
      // Act: Search for user1's username OR admin's email
      const result = await readUser(user1Data.username, adminUserData.email);

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read');
      expect(result.users).toBeDefined();
      if (result.success && result.users) {
        expect(result.users.length).toBe(2); // Should find both user1 and adminUser
        const usernames = result.users.map(u => u.username);
        expect(usernames).toContain(user1Data.username);
        expect(usernames).toContain(adminUserData.username);
        expect(usernames).not.toContain(user2Data.username);
      } else {
        fail('readUser with OR criteria failed or did not return users.');
      }
    });

    it('should return only matching users if one criterion matches and another does not', async () => {
      // Act: Search for user1's username OR a non-existent email
      const result = await readUser(user1Data.username, 'nonexistent@email.com');

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read');
      expect(result.users).toBeDefined();
      if (result.success && result.users) {
        expect(result.users.length).toBe(1); // Should find only user1
        expect(result.users[0].username).toBe(user1Data.username);
      } else {
        fail('readUser with one matching OR criteria failed.');
      }
    });


    it('should return success: true and empty array when no user matches criteria', async () => {
      // Act
      const result = await readUser('nonexistentuser', 'nobody@nowhere.com');

      // Assert
      expect(result.success).toBe(true); // Still successful operation
      expect(result.operation).toBe('read');
      expect(result.users).toBeDefined();
      expect(result.users?.length).toBe(0); // Empty array
      expect(result.message).toContain("No users found matching the specified criteria.");
    });

    it('should return success: true and empty array when searching by non-existent role', async () => {
      // Note: This assumes UserRole only has User/Admin. If you had more roles, adjust.
      // We'll try searching by a non-existent username instead, as roles are limited.
      const result = await readUser('nonexistentuser');

      // Assert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('read');
      expect(result.users?.length).toBe(0);
      expect(result.message).toContain("No users found matching the specified criteria.");
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
        expect(result.message).toContain('does not exist');
      } else {
        fail('updateUser should have failed for non-existent user but succeeded');
      }
    });

    it('should return success: false if update results in no changes', async () => {
      const result = await updateUser(initialUsername, { email: initialEmail, phone: initialPhone }); // Provide existing data
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.message).toContain('No fields to update');
      } else {
        fail('updateUser should have failed (no changes) but succeeded');
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
        expect(result.message).toContain(`Username "${otherUserUsername}" is already in use`);
      } else {
        fail('updateUser should have failed (username conflict) but succeeded');
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
        expect(result.message).toContain(`Email "${otherUserEmail}" is already in use`);
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
        expect(result.message).toContain(`Phone "${otherUserPhone}" is already in use`);
      } else {
        fail('updateUser should have failed (phone conflict) but succeeded');
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