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
export interface IUserDocument extends IUser, Document {
}


/*==================================== Project Section begins here =============================================*/
// Enumeration for file types
/**
 * Defines the possible file types for uploaded files.
 * This is used to specify the MIME type of the file.
 * @enum {string}
 * @property {string} NIFTI - Represents a NIfTI file (.nii).
 * @property {string} NIFTI_GZ - Represents a compressed NIfTI file (.nii.gz).
 * @property {string} DICOM - Represents a DICOM file (.dcm).
 */
export enum FileType {
    NIFTI = "image/nifti", // .nii
    NIFTI_GZ = "image/nifti-gz", // .nii.gz
    DICOM = "application/dicom", // .dcm
}

// Enumeration for DataType
/**
 * Defines the possible data types for images.
 * This is used to specify the data type of the image in the project.
 * @enum {string}
 * @property {string} UNKNOWN - Represents an unknown data type.
 * @property {string} FLOAT32 - Represents a 32-bit floating-point number.
 * @property {string} UINT16 - Represents a 16-bit unsigned integer.
 * @property {string} UINT8 - Represents an 8-bit unsigned integer.
 */
export enum FileDataType {
    UNKNOWN = "unknown",
    FLOAT32 = "float32", // common
    UINT16 = "uint16", // common
    UINT8 = "uint8", // common (often for segmentation masks)
    // To add if needed
}

/**
 * Defines the structure for a project record stored in the database.
 * This interface is used to represent a project that contains files and their metadata.
 * @interface IProject
 * @property {string} userid - The unique MongoDB user ID of the user who uploaded the file.
 * @property {string} name - The name of the project.
 * @property {string} originalfilename - The original filename of the uploaded file.
 * @property {string} description - A description of the project (optional).
 * @property {boolean} isSaved - Indicates if the project should be saved.
 * @property {string} filename - The server-renamed filename of the uploaded file, using a format of userid_filehash.nii preferably.
 * @property {FileType} filetype - The MIME type of the file (e.g., image/nifti, application/dicom).
 * @property {number} filesize - The size of the renamed file in bytes.
 * @property {string} filehash - The SHA256 hash of the renamed file.
 * @property {string} basepath - The base path for the file storage (e.g., s3://devel-visheart-s3-bucket/temp/"the-user-id"/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3).
 * @property {string} originalfilepath - The original file location (e.g., s3://devel-visheart-s3-bucket/temp/"the-user-id"/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz). 
 * @property {string} extractedfolderpath - The folder where all the extracted JPEGs from NIfTI are saved. (e.g. s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted)
 * @property {boolean} status.upload - Indicates if the file upload was successful.
 * @property {boolean} status.extract - Indicates if the file extraction was successful.
 * @property {boolean} status.component_bounding_box - Indicates if the component bounding box extraction was successful.
 * @property {boolean} status.segmentation - Indicates if the segmentation was successful.
 * @property {string} datatype - The data type of the image (e.g., uint8, float32).
 * @property {object} dimensions - The dimensions of the image.
 * @property {number} dimensions.width - The width of the image in pixels.
 * @property {number} dimensions.height - The height of the image in pixels.
 * @property {number} dimensions.slices - The depth/slices of the image in pixels (for 3D images).
 * @property {number} dimensions.frames - The time/frames dimension (optional, for 4D images).
 * @property {object} voxelsize - The physical size of one voxel, usually in mm.
 * @property {number} voxelsize.x - The size in the x-dimension.
 * @property {number} voxelsize.y - The size in the y-dimension.
 * @property {number} voxelsize.z - The size in the z-dimension (optional).
 * @property {number} voxelsize.t - The size in the t-dimension (optional).
 */
export interface IProject {
    // Identifiers
    // _id:  string; // MongoDB Object ID of the project, commented out if extended with mongoose.Document
    userid: string; // MongoDB User ID of the user who uploaded the file
    // User inputs
    name: string; // Name of the project
    originalfilename: string;
    description?: string;
    isSaved: boolean; // Indicates if the project is saved in the database
    // File properties
    filename: string; // Server rename - e.g., userid_projid.nii - use new mongoose.Types.ObjectId() to pregenerate before creating document in DB
    filetype: FileType; // MIME type of the file
    filesize: number; // Size of the renamed file in bytes
    filehash: string; // SHA256 hash of the renamed file
    // Location tracking
    basepath: string // Base path for the file storage (e.g., S3 bucket URL + user + filehash)
    originalfilepath: string; // Original (nifti/dicom) file location (e.g., S3 bucket URL)
    extractedfolderpath: string; // Saves the folder where all the extracted jpeg from nifti are saved. Use naming convention for each extracted jpeg as filename_slice_frame.jpeg
    // Processing status (might be issue since >1 bounding box and segmentation mask)
    status: {
        upload: boolean; // File upload status
        extract: boolean; // File extraction status
    }
    // File specifics
    datatype: FileDataType; // Data type of the image (e.g., uint8, float32)
    dimensions: {
        width: number; // Width of the image in pixels
        height: number; // Height of the image in pixels
        slices: number; // Depth/Slices of the image in pixels (for 3D images)
        frames?: number; // Time/Frames dimension (optional, for 4D images)
    }

    /** Physical size of one voxel (usually in mm). 
     * From NIfTI pixdim = [?, 0.5, 0.5, 1.0, 2.0, 0, 0, 0], first ? and last 3 zeroes are not used,
     * but the 4 numbers are in mm, mm, mm and seconds. */
    voxelsize?: { x: number; y: number; z?: number; t?: number; };

    // Based on mongoose timestamp
    createdAt?: Date; // Creation date of the project
    updatedAt?: Date; // Last update date of the project
}
// Project Model Interface (single project document in the database)
export interface IProjectDocument extends IProject, Document { }

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
 * This is a child of IProject and references back to the project it belongs to.
 * Stores the segmentation masks for a project as well as the component bounding boxes used to input into MedSAM for segmentation.
 * This interface is used to store the segmentation masks for a project.
 * @interface IProjectSegmentationMask
 * @property {string} projectid - The unique MongoDB project ID of the project to which the segmentation mask belongs.
 * @property {string} name - The name of the segmentation mask.
 * @property {string} description - A description of the segmentation mask (optional).
 * @property {boolean} isSaved - Indicates if the segmentation mask should be saved.
 * @property {boolean} isMedSAMOutput - Indicates if the segmentation mask is a MedSAM output (should not delete if its the output of MedSAM).
 * @property {object[]} frames - An array of frame objects, each containing slice information.
 * @property {number} frameIndex - The index of the frame (0-based).
 * @property {object[]} slices - An array of slice objects, each containing segmentation mask information.
 * @property {number} sliceindex - The index of the slice (0-based).
 * @property {string} slicepath - The path to the slice image (e.g., S3 bucket URL).
 * @property {object[]} componentboundingboxes - An array of component bounding box objects.
 * @property {string} class - The class of the component (e.g., rv, myo, lvc).
 * @property {number} x_min - The X coordinate of the minimum bounding box corner.
 * @property {number} y_min - The Y coordinate of the minimum bounding box corner.
 * @property {number} x_max - The X coordinate of the maximum bounding box corner.
 * @property {number} y_max - The Y coordinate of the maximum bounding box corner.
 * @property {object[]} segmentationmaskslocation - An array of segmentation mask location objects.
 * @property {string} path - The path to the segmentation mask CSV (e.g., S3 bucket URL).
 * @property {boolean} isRLE - Indicates if the mask is in RLE format.
 */
export interface IProjectSegmentationMask {
    // Identifiers
    // _id:  string; // MongoDB Object ID of the segmentation mask
    projectid: string; // MongoDB Project ID of the project to which the segmentation mask belongs
    // User inputs
    name: string; // Name of the segmentation mask
    description?: string; // Description of the segmentation mask
    isSaved: boolean; // Indicates if the segmentation mask is saved in the database
    isMedSAMOutput: boolean; // Indicates if the segmentation mask is a MedSAM output (should not delete if its the output of MedSAM)
    // Properties of the extracted folder + location tracking
    // Note - index are 0-based
    // If the segmentation mask is a single frame, there will be only one entry in the frames array
    frames: {
        frameIndex: number;
        slices: {
            sliceindex: number;
            slicepath: string; // Path to the slice image (e.g., S3 bucket URL)
            componentboundingboxes?: {
                class: ComponentBoundingBoxesClass; // Class of the component (e.g., rv, myo, lvc)
                x_min: number; // X coordinate of the minimum bounding box corner
                y_min: number; // Y coordinate of the minimum bounding box corner
                x_max: number; // X coordinate of the maximum bounding box corner
                y_max: number; // Y coordinate of the maximum bounding box corner
            }[];
            segmentationmaskslocation?: { // 3 CSV(?) per class mask
                path: string; // Path to the segmentation mask csv(?) (e.g., S3 bucket URL)
                isRLE: boolean; // Indicates if the mask is in RLE format
            }[];
        }[];
    }[];

    // Based on mongoose timestamp
    createdAt?: Date; // Creation date of the project
    updatedAt?: Date; // Last update date of the project
}
// Segmentation Mask Model Interface (single segmentation mask document in the database)
export interface IProjectSegmentationMaskDocument extends IProjectSegmentationMask, Document {
}
/*==================================== Project Section ends here =============================================*/


/* Database Functions */
/**
 * Enumerates the types of CRUD (Create, Read, Update, Delete) operations,
 * plus an 'AUTHENTICATE' operation specific to user login.
 * Used in the result objects of database functions to indicate the action performed.
 * @enum {string}
 * General CRUD operations:
 * @property {string} CREATE - Represents a create operation.
 * @property {string} READ - Represents a read operation.
 * @property {string} UPDATE - Represents an update operation.
 * @property {string} DELETE - Represents a delete operation.
 * Auxiliary operations:
 * User:
 * @property {string} AUTHENTICATE - Represents an authentication operation. Specifically for PassportJS integration.
 * Project:
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
    // Project specific operations
}
// Define result type for user CRUD operations
/**
 * Defines the standard structure for the result object returned by user-related database operations
 * (create, read, update, delete, authenticate).
 * @interface UserCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IUserSafe} [user] - The resulting user object (sanitized), typically included on successful CREATE, UPDATE, or AUTHENTICATE operations.
 * @property {IUserSafe[]} [users] - An array of user objects (sanitized), typically included on successful READ operations. Can be empty if no users match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, user not found) or warnings.
 */
export interface UserCrudResult {
    success: boolean; // Indicates whether the operation was successful
    operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
    user?: IUserSafe; // The created or updated user document (applicable for CREATE and UPDATE operations)
    users?: IUserSafe[]; // Array of user documents (applicable for READ operation)
    message?: string; // Message if error/warning occurred (applicable for all operations)
}

export interface ProjectCrudResult {
    success: boolean; // Indicates whether the operation was successful
    operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
    project?: IProject; // The created or updated project document (applicable for CREATE and UPDATE operations)
    projects?: IProject[]; // Array of project documents (applicable for READ operation)
    message?: string; // Message if error/warning occurred (applicable for all operations)
    // segmentationmask?: IProjectSegmentationMask; // Commented as it is inside the project document
}
