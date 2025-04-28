import sys
import os
import nibabel as nib
import matplotlib.pyplot as plt
import pydicom
import subprocess

def convert_nifti_to_jpeg(input_file, output_dir, user_id, project_id):
    try:
        img = nib.load(input_file)
        data = img.get_fdata()
        os.makedirs(output_dir, exist_ok=True)
        
        # Check if the NIfTI file has 4 dimensions (includes time frames)
        if len(data.shape) == 4:
            # 4D NIfTI: x, y, z (slices), t (frames)
            for frame_idx in range(data.shape[3]):  # Frame dimension (t)
                for slice_idx in range(data.shape[2]):  # Slice dimension (z)
                    output_path = os.path.join(output_dir, f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg")
                    plt.imsave(output_path, data[:, :, slice_idx, frame_idx], cmap='gray')
                    print(f"Converted frame {frame_idx}, slice {slice_idx} to JPEG.")
        else:
            # 3D NIfTI: x, y, z (slices only, no frames)
            for slice_idx in range(data.shape[2]):  # Slice dimension (z)
                output_path = os.path.join(output_dir, f"{user_id}_{project_id}_0_{slice_idx}.jpg")
                plt.imsave(output_path, data[:, :, slice_idx], cmap='gray')
                print(f"Converted slice {slice_idx} to JPEG (no frames).")
    except Exception as e:
        print(f"Error converting NIfTI file {input_file}: {e}")
        sys.exit(1)

def convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id):
    try:
        ds = pydicom.dcmread(input_file)
        pixel_array = ds.pixel_array
        os.makedirs(output_dir, exist_ok=True)
        
        if len(pixel_array.shape) == 3:
            # Typical multi-frame DICOM has shape (frames, rows, columns)
            for frame_idx in range(pixel_array.shape[0]):
                # For each frame in a multi-frame DICOM, we use the frame index
                # as both frame and slice index since there's no separate slice concept
                slice_idx = frame_idx
                output_path = os.path.join(output_dir, f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg")
                plt.imsave(output_path, pixel_array[frame_idx], cmap='gray')
                print(f"Converted frame {frame_idx}, slice {slice_idx} to JPEG.")
        else:
            # Single-frame DICOM typically has shape (rows, columns)
            # Use 0 for both frame and slice index
            output_path = os.path.join(output_dir, f"{user_id}_{project_id}_0_0.jpg")
            plt.imsave(output_path, pixel_array, cmap='gray')
            print(f"Converted single-frame DICOM to JPEG.")
    except Exception as e:
        print(f"Error converting DICOM file {input_file}: {e}")
        sys.exit(1)

def bundle_to_tar(output_dir, tar_file):
    try:
        # Use the tar command to bundle the directory into a .tar file
        subprocess.run(["tar", "-cf", tar_file, "-C", output_dir, "."], check=True)
        print(f"Bundled files into {tar_file}")
    except subprocess.CalledProcessError as e:
        print(f"Error creating tarball {tar_file}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    tar_file = sys.argv[3]  # Path to the output .tar file
    user_id = sys.argv[4]   # User ID
    project_id = sys.argv[5]  # Project ID

    if input_file.endswith((".nii", ".nii.gz")):
        convert_nifti_to_jpeg(input_file, output_dir, user_id, project_id)
    elif input_file.endswith(".dcm"):
        convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id)
    else:
        print("Unsupported file type.")
        sys.exit(1)

    # Bundle the converted files into a .tar file
    bundle_to_tar(output_dir, tar_file)
    print(f"Files converted and bundled into {tar_file}")