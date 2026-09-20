//! Stable entry identity on Windows; unsupported filesystems fail closed.
use std::fs::{File, Metadata};
use std::io;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
};

#[derive(PartialEq, Eq)]
struct Identity {
    volume: u64,
    file: [u8; 16],
}

fn identity(file: &File) -> io::Result<Identity> {
    let mut information = std::mem::MaybeUninit::<FILE_ID_INFO>::uninit();
    // SAFETY: File owns a live handle for this call. The output buffer is aligned
    // and exactly FILE_ID_INFO-sized; it is read only after Windows reports success.
    let result = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            information.as_mut_ptr().cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: The successful API call initialized the complete FILE_ID_INFO.
    let information = unsafe { information.assume_init() };
    if information.FileId.Identifier == [0; 16] {
        return Err(io::Error::other(
            "filesystem did not provide a stable file ID",
        ));
    }
    Ok(Identity {
        volume: information.VolumeSerialNumber,
        file: information.FileId.Identifier,
    })
}

pub(crate) struct EntryMetadata {
    metadata: Metadata,
    identity: Identity,
    // Retain the original open file so its ID cannot be recycled before comparison.
    _file: File,
}

impl EntryMetadata {
    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        Ok(Self {
            metadata: file.metadata()?,
            identity: identity(&file)?,
            _file: file,
        })
    }

    pub(crate) fn is_file(&self) -> bool {
        self.metadata.is_file()
    }

    pub(crate) fn matches(&self, file: &File) -> io::Result<bool> {
        Ok(file.metadata()?.is_file() && self.identity == identity(file)?)
    }
}
