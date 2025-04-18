import { Document } from "mongoose";

/* Interfaces */
// Enumeration for user roles
/**
 * Defines the possible roles a user can have within the application.
 * @enum {string}
 * @property {string} User - Represents a standard user with basic permissions.
 * @property {string} Admin - Represents an administrator with elevated privileges.
 */
export enum UserRole {
    User = "user",
    Admin = "admin",
    Guest = "guest", // For temporary users
}

/**
 * Defines the structure for a user object as stored in the database, including sensitive information.
 * @interface IUser
 * @property {string} username - The unique username for the user.
 * @property {string} password - The user's hashed password.
 * @property {string} email - The user's unique email address.
 * @property {string} phone - The user's unique phone number.
 * @property {UserRole} role - The role assigned to the user (e.g., User, Admin).
 */
export interface IUser {
    username: string;
    password: string;
    email: string;
    phone: string;
    role: UserRole; // Default to "user" unless specified otherwise
}

/**
 * Defines the structure for a user object that is safe to expose publicly or send to clients.
 * It omits sensitive information like the password hash.
 * @interface IUserSafe
 * @property {string} _id - The unique MongoDB document ID for the user, represented as a string.
 * @property {string} username - The unique username of the user.
 * @property {string} email - The email address of the user.
 * @property {string} phone - The phone number of the user.
 * @property {UserRole} role - The role of the user (e.g., User, Admin).
 */
export interface IUserSafe {
    _id: string; // MongoDB Object ID of the user
    username: string;
    email: string;
    phone: string;
    role: UserRole; // Default to "user" unless specified otherwise
}
// User Model Interface (single user document in the database)
export interface IUserDocument extends IUser, Document { }

// File Interface - Defines a saved file record in the database
// File types
// Enumeration for File MIME types
/**
 * Defines the possible roles a user can have within the application.
 * @enum {string}
 * @property {string} User - Represents a standard user with basic permissions.
 * @property {string} Admin - Represents an administrator with elevated privileges.
 * @property {string} Guest - Represents a temporary user with limited access.
 */
export enum FileType {
    NIFTI = "image/nifti", // .nii
    NIFTI_GZ = "image/nifti-gz", // .nii.gz
    DICOM = "application/dicom", // .dcm
}

/**
 * Defines the structure for a project record stored in the database.
 */
export interface IProject {
    // Identifiers
    // _id:  string; // MongoDB Object ID of the project, commented out if extended with mongoose.Document
    userid: string; // MongoDB User ID of the user who uploaded the file
    // User inputs
    name: string; // Name of the project
    originalfilename: string;
    description?: string;
    // File properties
    filename: string; // Server rename - e.g., userid_projid.nii - use new mongoose.Types.ObjectId() to pregenerate before creating document in DB
    filetype: FileType; // MIME type of the file
    filesize: number; // Size of the renamed file in bytes
    filehash: string; // SHA256 hash of the renamed file
    // Location tracking
    basepath: string // Base path for the file storage (e.g., S3 bucket URL)
    originalfilepath: string; // Original (nifti/dicom) file location (e.g., S3 bucket URL)
    extractedfolderpath: string; // Saves the folder where all the extracted jpeg from nifti are saved. Use naming convention for each extracted jpeg as filename_slice_frame.jpeg
    // Processing status
    status: {
        upload: boolean; // File upload status
        extract: boolean; // File extraction status
        component_bounding_box: boolean; // Component bounding box extraction status
        segmentation: boolean; // Segmentation status
    }
    // File specifics
    datatype: string; // Data type of the image (e.g., uint8, float32)
    dimensions: {
        width: number; // Width of the image in pixels
        height: number; // Height of the image in pixels
        slices: number; // Depth/Slices of the image in pixels (for 3D images)
        frames?: number; // Time/Frames dimension (optional, for 4D images)
    }
    // DB to DB tracking
    // All segmentations in this project
    segmentationmaskids?: string[]; // Array of MongoDB Object IDs for segmentation masks associated with this project

    /** Physical size of one voxel (usually in mm). From NIfTI pixdim[1,2,3,4]. */
    voxelSize?: { x: number; y: number; z: number; t?: number; };
}

// Enumeration for component bounding box classes
/**
 * Defines the possible classes for component bounding boxes in segmentation masks.
 * @enum {string}
 * @property {string} rv - Represents the right ventricle.
 * @property {string} myo - Represents the myocardium.
 * @property {string} lvc - Represents the left ventricle cavity.
 */
export enum ComponentBoundingBoxesClass {
    rv = "rv",
    myo = "myo",
    lvc = "lvc",
}


/**
 * Defines the structure for a project's segmentation masks.
 * This should be a child of IProject.
 * This interface is used to store the segmentation masks for a project.
 * @interface IProjectSegmentationMask
 */
export interface IProjectSegmentationMask {
    // Identifiers
    // _id:  string; // MongoDB Object ID of the segmentation mask
    projectid: string; // MongoDB Project ID of the project to which the segmentation mask belongs
    // User inputs
    name: string; // Name of the segmentation mask
    description?: string; // Description of the segmentation mask
    // Properties of the extracted folder + location tracking
    // Note - index are 0-based
    frames: {
        frameIndex: number;
        slices: {
            sliceIndex: number;
            slicePath: string; // Path to the slice image (e.g., S3 bucket URL)
            componentboundingBoxes?: {
                class: ComponentBoundingBoxesClass; // Class of the component (e.g., rv, myo, lvc)
                x_min: number; // X coordinate of the minimum bounding box corner
                y_min: number; // Y coordinate of the minimum bounding box corner
                x_max: number; // X coordinate of the maximum bounding box corner
                y_max: number; // Y coordinate of the maximum bounding box corner
            }[];
            segmentationmasks?: { // 3 CSV(?) per class mask
                path: string; // Path to the segmentation mask csv(?) (e.g., S3 bucket URL)
                isRLE: boolean; // Indicates if the mask is in RLE format
            }[];
        }[];
    }[];
}



/* Database Functions */
/**
 * Enumerates the types of CRUD (Create, Read, Update, Delete) operations,
 * plus an 'AUTHENTICATE' operation specific to user login.
 * Used in the result objects of database functions to indicate the action performed.
 * @enum {string}
 */
export enum CRUDOperation {
    CREATE = "create",
    READ = "read",
    UPDATE = "update",
    DELETE = "delete",
    /**
     * AUTHENTICATE is used for user authentication operations and is not a standard CRUD operation,
     * but it is included here for consistency in reporting operation types, especially for PassportJS integration.
     */
    AUTHENTICATE = "authenticate",

}
