import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase, userModel, fileModel, createUser, updateUser } from '../src/services/database';
import bcrypt from 'bcrypt';

// Mocking logger to prevent console output during tests
jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

let mongoServer: MongoMemoryServer;

// Setup in-memory MongoDB server
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

// Clean up after tests
afterAll(async () => {
  await mongoose.connection.close();
  await mongoServer.stop();
});

// Clear data between tests
beforeEach(async () => {
  // Clear all collections
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Database Service', () => {
  // Test connectToDatabase
  describe('connectToDatabase', () => {
    it('should connect to the database', async () => {
      expect(mongoose.connection.readyState).toBe(1); // 1 = connected
    });
  });

  // Test createUser
  describe('createUser', () => {
    it('should create a new user successfully', async () => {
      // Create a test user
      const result = await createUser(
        'testuser',
        'password123',
        'test@example.com',
        '1234567890'
        // role is omitted for default 'user' - to check
      );
      // Check if operation was successful
      expect(result).toBeTruthy();
      if (result.success === true) {
        expect(result.user).toBeDefined();
        expect(result.user.username).toBe('testuser');
        expect(result.user.email).toBe('test@example.com');
        expect(result.user.phone).toBe('1234567890');
        expect(result.user.role).toBe('user'); // Default role
      }
      // Verify the user was saved to the database by querying it directly
      const savedUser = await userModel.findOne({ username: 'testuser' });
      expect(savedUser).not.toBeNull();
      expect(savedUser?.email).toBe('test@example.com');
      expect(savedUser?.phone).toBe('1234567890');

      // Optional: Verify password was properly hashed
      const passwordMatches = await bcrypt.compare('password123', savedUser!.password);
      expect(passwordMatches).toBe(true);
    });
  });

  // Test updateUser
  describe('updatedUser', () => {
    it('should update an existing user successfully', async () => {
      // Add a test user first (using previous test code)
      const result = await createUser(
        'testuser',
        'password123',
        'test@example.com',
        '1234567890'
        // role is omitted for default 'user' - to check
      );
      // Check if operation was successful
      expect(result).toBeTruthy();
      if (result.success === true) {
        expect(result.user).toBeDefined();
        // Check the other fields remain unchanged
        expect(result.user.username).toBe('testuser');
        expect(result.user.email).toBe('test@example.com');
        expect(result.user.phone).toBe('1234567890');
        expect(result.user.role).toBe('user'); // Default role
      }
      // Verify the user was saved to the database by querying it directly
      const savedUser = await userModel.findOne({ username: 'testuser' });
      expect(savedUser).not.toBeNull();
      expect(savedUser?.email).toBe('test@example.com');
      expect(savedUser?.phone).toBe('1234567890');

      // Optional: Verify password was properly hashed
      const passwordMatches = await bcrypt.compare('password123', savedUser!.password);
      expect(passwordMatches).toBe(true);

      /* Update User Test Section */
      // Test is broken down into {email, phone}, {password}, {role}, {username} to check if only the updated field is changed
      // 1. Assume {email, phone} is updated
      const updateResult = await updateUser(
        'testuser',
        {
          email: 'test2@example.com',
          phone: '99999999',
        }
      )
      // Check if operation was successful
      expect(updateResult).toBeTruthy();
      if (updateResult.success === true) {
        expect(updateResult.user.email).toBe('test2@example.com'); // Updated email
        expect(updateResult.user.phone).toBe('99999999'); // Updated phone
        // Check the other fields remain unchanged
        expect(updateResult.user.username).toBe('testuser');
        expect(updateResult.user.role).toBe('user'); // Default role
        // Cannot check password here as it is hashed in the database
      }
      // Verify the user was updated in the database by querying it directly
      const updatedUser = await userModel.findOne({ username: 'testuser' });
      expect(updatedUser).not.toBeNull();
      // Check updated fields
      expect(updatedUser?.email).toBe('test2@example.com'); // Updated email
      expect(updatedUser?.phone).toBe('99999999'); // Updated phone
      // Check that other fields remain unchanged
      expect(updatedUser?.username).toBe('testuser'); // Unchanged username
      expect(updatedUser?.role).toBe('user'); // Default role
      let passwordMatchesAfterUpdate = await bcrypt.compare('password123', updatedUser!.password);
      expect(passwordMatchesAfterUpdate).toBe(true); // Password should remain unchanged

      // 2. Assume {password} is updated
      const updateResult2 = await updateUser(
        'testuser',
        { password: 'imtiredpleasehelpme', });
      // Check if operation was successful
      expect(updateResult2.success).toBeTruthy();
      if (updateResult2.success === true) {
        // Check the other fields remain unchanged
        expect(updateResult2.user.username).toBe('testuser');
        expect(updateResult2.user.email).toBe('test2@example.com');
        expect(updateResult2.user.phone).toBe('99999999');
        expect(updateResult2.user.role).toBe('user'); // Default role
        // Cannot chek passwouser.rd here as it is hashed in the database
      }
      // Verify the user was updated in the database by querying it directly
      const updatedUser2 = await userModel.findOne({ username: 'testuser' });
      expect(updatedUser2).not.toBeNull();
      // Check updated fields
      passwordMatchesAfterUpdate = await bcrypt.compare('imtiredpleasehelpme', updatedUser2!.password);
      expect(passwordMatchesAfterUpdate).toBe(true); // Password should be changed
      // Check that other fields remain unchanged
      expect(updatedUser2?.username).toBe('testuser'); // Unchanged username
      expect(updatedUser2?.email).toBe('test2@example.com'); // Updated email
      expect(updatedUser2?.phone).toBe('99999999'); // Updated phone
      expect(updatedUser2?.role).toBe('user'); // Default role

      // 3. Assume {role} is updated
      const updateResult3 = await updateUser(
        'testuser',
        { role: 'admin' });
      // Check if operation was successful
      expect(updateResult3.success).toBeTruthy();
      if (updateResult3.success === true) {
        expect(updateResult3.user.role).toBe('admin'); // Updated admin role
        // Check the other fields remain unchanged
        expect(updateResult3.user.username).toBe('testuser');
        expect(updateResult3.user.email).toBe('test2@example.com');
        expect(updateResult3.user.phone).toBe('99999999');
        // Cannot check password here as it is hashed in the database      
      }
      // Verify the user was updated in the database by querying it directly
      const updatedUser3 = await userModel.findOne({ username: 'testuser' });
      expect(updatedUser3).not.toBeNull();
      // Check updated fields
      expect(updatedUser3?.role).toBe('admin'); // Updated admin role
      // Check that other fields remain unchanged
      expect(updatedUser3?.username).toBe('testuser'); // Unchanged username
      expect(updatedUser3?.email).toBe('test2@example.com'); // Updated email
      expect(updatedUser3?.phone).toBe('99999999'); // Updated phone
      passwordMatchesAfterUpdate = await bcrypt.compare('imtiredpleasehelpme', updatedUser3!.password);
      expect(passwordMatchesAfterUpdate).toBe(true); // Password should remain unchanged

      // 4. Assume {username} is updated
      const updateResult4 = await updateUser(
        'testuser',
        { username: 'testuser2' });
      // Check if operation was successful
      expect(updateResult4.success).toBeTruthy();
      if (updateResult4.success === true) {
        expect(updateResult4.user.username).toBe('testuser2'); // Updated username
        // Check the other fields remain unchanged
        expect(updateResult4.user.email).toBe('test2@example.com');
        expect(updateResult4.user.phone).toBe('99999999');
        expect(updateResult4.user.role).toBe('admin');
        // Cannot check password here as it is hashed in the database
      }
      // Verify the user was updated in the database by querying it directly
      const updatedUser4 = await userModel.findOne({ username: 'testuser2' });
      expect(updatedUser4).not.toBeNull();
      // Check updated fields
      expect(updatedUser4?.username).toBe('testuser2'); // Updated username
      // Check that other fields remain unchanged
      expect(updatedUser4?.email).toBe('test2@example.com'); // Updated email
      expect(updatedUser4?.phone).toBe('99999999'); // Updated phone
      expect(updatedUser4?.role).toBe('admin'); // Updated admin role
      passwordMatchesAfterUpdate = await bcrypt.compare('imtiredpleasehelpme', updatedUser3!.password);
      expect(passwordMatchesAfterUpdate).toBe(true); // Password should remain unchanged
    });
  })
});
