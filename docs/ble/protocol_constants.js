// GATT service UUIDs
export const NORDIC_UART_SERVICE_UUID           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NORDIC_UART_CHRC_TX_UUID           = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NORDIC_UART_CHRC_RX_UUID           = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const WACOM_LIVE_SERVICE_UUID            = '00001523-1212-efde-1523-785feabcd123';
export const WACOM_CHRC_LIVE_PEN_DATA_UUID      = '00001524-1212-efde-1523-785feabcd123';
export const WACOM_OFFLINE_SERVICE_UUID         = 'ffee0001-bbaa-9988-7766-554433221100';
export const WACOM_OFFLINE_CHRC_PEN_DATA_UUID   = 'ffee0003-bbaa-9988-7766-554433221100';
export const SYSEVENT_NOTIFICATION_SERVICE_UUID = '3a340720-c572-11e5-86c5-0002a5d5c51b';
export const SYSEVENT_NOTIFICATION_CHRC_UUID    = '3a340721-c572-11e5-86c5-0002a5d5c51b';

// Opcodes sent to device (TX)
export const OPCODE_CONNECT              = 0xe6;
export const OPCODE_GET_NAME            = 0xbb;
export const OPCODE_SET_NAME            = 0xbb;
export const OPCODE_GET_TIME            = 0xb6;
export const OPCODE_SET_TIME            = 0xb6;
export const OPCODE_GET_FIRMWARE        = 0xb7;
export const OPCODE_GET_BATTERY         = 0xb9;
export const OPCODE_SET_MODE            = 0xb1;
export const OPCODE_AVAILABLE_FILES     = 0xc1;
export const OPCODE_DOWNLOAD_OLDEST     = 0xc3;
export const OPCODE_DELETE_OLDEST       = 0xca;
export const OPCODE_GET_STROKES_SPARK   = 0xc5;
export const OPCODE_GET_STROKES         = 0xcc;
export const OPCODE_REGISTER_PRESS_SPARK = 0xe3;
export const OPCODE_REGISTER_PRESS      = 0xe7;
export const OPCODE_REGISTER_COMPLETE   = 0xe5;
export const OPCODE_UNKNOWN_E3          = 0xe3;
export const OPCODE_SET_FILE_TRANSFER   = 0xec;
export const OPCODE_GET_DIMENSIONS      = 0xea;
export const OPCODE_GET_NAME_INTUOS_PRO = 0xdb;

// Opcodes received from device (RX replies)
export const REPLY_CONNECT_OK           = 0x50;
export const REPLY_CONNECT_FAIL         = 0x51;
export const REPLY_ACK                  = 0xb3;
export const REPLY_GET_NAME             = 0xbc;
export const REPLY_GET_TIME             = 0xbd;
export const REPLY_GET_FIRMWARE         = 0xb8;
export const REPLY_GET_BATTERY          = 0xba;
export const REPLY_GET_DIMENSIONS       = 0xeb;
export const REPLY_AVAILABLE_FILES      = 0xc2;
export const REPLY_DOWNLOAD_OLDEST      = 0xc8;
export const REPLY_GET_STROKES_COUNT    = 0xc7;
export const REPLY_GET_STROKES_TS       = 0xcd;
export const REPLY_GET_STROKES          = 0xcf;
export const REPLY_REGISTER_WAIT        = 0xe4;
export const REPLY_REGISTER_INTUOS_PRO  = 0x53;
export const REPLY_CRC                  = 0xc9;

// Device modes
export const MODE_LIVE  = 0x00;
export const MODE_PAPER = 0x01;
export const MODE_IDLE  = 0x02;

// Protocol versions (for internal use)
export const PROTOCOL_SPARK     = 1;
export const PROTOCOL_SLATE     = 2;
export const PROTOCOL_INTUOS_PRO = 3;

// SET_FILE_TRANSFER_REPORTING_TYPE args — routes data to FFEE0003 GATT
export const FILE_TRANSFER_ARGS = [0x06, 0x00, 0x00, 0x00, 0x00, 0x00];
