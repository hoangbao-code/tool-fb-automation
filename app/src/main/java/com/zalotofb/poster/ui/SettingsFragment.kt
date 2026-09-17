package com.zalotofb.poster.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.databinding.FragmentSettingsBinding
import com.zalotofb.poster.domain.template.TemplateEngine

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    private lateinit var prefs: PreferenceStorage

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        prefs = PreferenceStorage(requireContext())

        loadSettings()

        binding.btnSaveSettings.setOnClickListener {
            saveSettings()
        }

        binding.btnGrantNotification.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    private fun loadSettings() {
        binding.etReplacePhone.setText(prefs.hotline ?: "")
        binding.etSignature.setText(prefs.signature ?: "")
        binding.etAiTemplate.setText(prefs.customTemplate ?: TemplateEngine.DEFAULT_TEMPLATE)
    }

    private fun saveSettings() {
        val hotline = binding.etReplacePhone.text?.toString()?.trim()
        val signature = binding.etSignature.text?.toString()?.trim()
        val template = binding.etAiTemplate.text?.toString()?.trim()

        prefs.hotline = hotline?.ifBlank { null }
        prefs.signature = signature?.ifBlank { null }
        prefs.customTemplate = template?.ifBlank { null }

        Toast.makeText(requireContext(), "Đã lưu cài đặt bảo mật thành công!", Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
