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
        total_slices = data.shape[2]
        total_frames = data.shape[3] if len(data.shape) == 4 else 0

        print(f"Processing NIfTI file: {input_file} with {total_slices} slices and {total_frames} frames.")

        if len(data.shape) == 4:
            for frame_idx in range(data.shape[3]):
                for slice_idx in range(data.shape[2]):
                    output_path = os.path.join(output_dir, f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg")
                    plt.imsave(output_path, data[:, :, slice_idx, frame_idx], cmap='gray')
                # Removed per-slice print for frames
            print(f"Converted all {total_slices} slices for frame {frame_idx}.")
        else:
            for slice_idx in range(data.shape[2]):
                output_path = os.path.join(output_dir, f"{user_id}_{project_id}_0_{slice_idx}.jpg")
                plt.imsave(output_path, data[:, :, slice_idx], cmap='gray')
            print(f"Converted all {total_slices} slices (no frames).")
        print(f"Successfully converted NIfTI file: {input_file} to JPEGs in {output_dir}")
    except Exception as e:
        print(f"Error converting NIfTI file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)

def convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id):
    try:
        ds = pydicom.dcmread(input_file)
        pixel_array = ds.pixel_array
        os.makedirs(output_dir, exist_ok=True)
        num_frames = pixel_array.shape[0] if len(pixel_array.shape) == 3 else 1

        print(f"Processing DICOM file: {input_file} with {num_frames} frames.")

        if len(pixel_array.shape) == 3:
            for frame_idx in range(pixel_array.shape[0]):
                slice_idx = frame_idx
                output_path = os.path.join(output_dir, f"{user_id}_{project_id}_{frame_idx}_{slice_idx}.jpg")
                plt.imsave(output_path, pixel_array[frame_idx], cmap='gray')
            print(f"Converted all {num_frames} frames to JPEGs.")
        else:
            output_path = os.path.join(output_dir, f"{user_id}_{project_id}_0_0.jpg")
            plt.imsave(output_path, pixel_array, cmap='gray')
            print("Converted single-frame DICOM to JPEG.")
        print(f"Successfully converted DICOM file: {input_file} to JPEGs in {output_dir}")
    except Exception as e:
        print(f"Error converting DICOM file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)

def bundle_to_tar(output_dir, tar_file):
    try:
        subprocess.run(["tar", "-cf", tar_file, "-C", output_dir, "."], check=True)
        print(f"Bundled files into {tar_file}")
        # Importantly, print the full path to stdout
        print(f"TAR_FILE_PATH:{os.path.abspath(tar_file)}")
    except subprocess.CalledProcessError as e:
        print(f"Error creating tarball {tar_file}: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    tar_file = sys.argv[3]  # Path to the output .tar file
    user_id = sys.argv[4]   # User ID
    project_id = sys.argv[5] # Project ID

    print(f"Starting conversion of {input_file} for user {user_id}, project {project_id}.")

    if input_file.endswith((".nii", ".nii.gz")):
        convert_nifti_to_jpeg(input_file, output_dir, user_id, project_id)
    elif input_file.endswith(".dcm"):
        convert_dicom_to_jpeg(input_file, output_dir, user_id, project_id)
    else:
        print("Unsupported file type.", file=sys.stderr)
        sys.exit(1)

    # Bundle the converted files into a .tar file
    tar_file_base = f"{user_id}_{project_id}_jpegs.tar"
    
    # Ensure 'temp_jpeg' directory exists
    output_dir = output_dir.replace('temp_jpeg', 'temp_jpeg')  # This line does nothing — maybe you meant something else?
    os.makedirs(output_dir, exist_ok=True)

    # Construct the path for the tar file inside the output directory
    tar_file_path = os.path.join(output_dir, tar_file_base)
    
    bundle_to_tar(output_dir, tar_file_path)
    print(f"Files converted and bundled into {tar_file_path}")