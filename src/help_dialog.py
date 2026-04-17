import tkinter as tk
from tkinter import ttk

from help_content import GETTING_STARTED, LIVE_MODE, SHORTCUTS_AND_TIPS, ABOUT


class HelpDialog(tk.Toplevel):
    """Non-resizable Help dialog with four informational tabs."""

    _WIDTH = 600
    _HEIGHT = 400

    def __init__(self, parent):
        super().__init__(parent)
        self.title('PandaInk Help')
        self.resizable(False, False)
        self.transient(parent)

        self._centre_on_parent(parent)

        notebook = ttk.Notebook(self)
        notebook.pack(fill='both', expand=True, padx=8, pady=(8, 4))

        for title, content in [
            ('Getting Started', GETTING_STARTED),
            ('Live Mode',       LIVE_MODE),
            ('Shortcuts & Tips', SHORTCUTS_AND_TIPS),
            ('About',           ABOUT),
        ]:
            notebook.add(self._make_tab(notebook, content), text=title)

        ttk.Button(self, text='Close', command=self.destroy).pack(pady=(0, 8))

        self.grab_set()

    def _make_tab(self, parent, content):
        frame = ttk.Frame(parent)

        text = tk.Text(frame, wrap='word', relief='flat',
                       padx=8, pady=6,
                       width=self._WIDTH // 7,   # approximate character width
                       height=self._HEIGHT // 20)
        text.insert('1.0', content)
        text.configure(state='disabled')

        scrollbar = ttk.Scrollbar(frame, orient='vertical', command=text.yview)
        text.configure(yscrollcommand=scrollbar.set)

        scrollbar.pack(side='right', fill='y')
        text.pack(side='left', fill='both', expand=True)

        return frame

    def _centre_on_parent(self, parent):
        self.geometry(f'{self._WIDTH}x{self._HEIGHT}')
        self.update_idletasks()

        px = parent.winfo_rootx()
        py = parent.winfo_rooty()
        pw = parent.winfo_width()
        ph = parent.winfo_height()

        x = px + (pw - self._WIDTH) // 2
        y = py + (ph - self._HEIGHT) // 2

        self.geometry(f'{self._WIDTH}x{self._HEIGHT}+{x}+{y}')
